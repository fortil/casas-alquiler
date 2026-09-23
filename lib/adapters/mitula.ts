import type { Listing, ResolvedCrawlParams } from "@/lib/core/schema";
import { absolutize, load, type Cheerio } from "@/lib/adapters/base/parse";
import { parseArea, parseIntSafe, parsePriceCOP, titleCase } from "@/lib/util/text";
import { HttpClient } from "@/lib/adapters/base/httpClient";
import type { AdapterContext, SourceAdapter } from "@/lib/adapters/types";

const BASE = "https://casas.mitula.com.co";

/**
 * Full browser headers. A minimal UA gets HTTP 401; navigation hints get 200.
 * (HttpClient/BROWSER_HEADERS already supply UA + Accept-Language + Accept.)
 */
const NAV_HEADERS: Record<string, string> = {
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-User": "?1",
  "Upgrade-Insecure-Requests": "1",
  "sec-ch-ua": '"Chromium";v="131", "Not_A Brand";v="24"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"macOS"',
};

/** "casa" -> "arriendo-{city}"; "apartamento" -> "arriendo-apartamentos-{city}". */
function pathSlug(propertyType: ResolvedCrawlParams["propertyType"], city: string): string {
  const seg = propertyType === "apartamento" ? `arriendo-apartamentos-${city}` : `arriendo-${city}`;
  return `${BASE}/casas/${seg}`;
}

/** Mitula maps "jamundi" / "cali" directly to its own city slug. */
function citySlug(city: string): string {
  return city.trim().toLowerCase();
}

/** schema.org item from the SearchResultsPage JSON-LD `about[]` array (per card, by index). */
interface MitulaAboutItem {
  name?: string;
  description?: string;
  numberOfBedrooms?: number;
  numberOfBathroomsTotal?: number;
  address?: {
    streetAddress?: string;
    addressLocality?: string;
    addressRegion?: string;
  };
  floorSize?: { value?: string | number };
  geo?: { latitude?: string | number; longitude?: string | number };
}

/** Extract the SearchResultsPage `about[]` array (geo + richer metadata, aligned by card index). */
function extractAbout($: Cheerio): MitulaAboutItem[] {
  const raw = $('script[type="application/ld+json"]').first().contents().text();
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  const arr = Array.isArray(parsed) ? parsed : [parsed];
  for (const node of arr) {
    if (!node || typeof node !== "object") continue;
    const obj = node as Record<string, unknown>;
    if (obj["@type"] === "SearchResultsPage" && Array.isArray(obj.about)) {
      return obj.about as MitulaAboutItem[];
    }
  }
  return [];
}

function toFloat(v: string | number | undefined): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Cards link OUT to the origin portal via a base64 `data-clickdestination`.
 * Decode it: if it yields a full http(s) URL use that; if it yields a relative
 * path (e.g. "/adform/..."), absolutize it against the Mitula base; else fall
 * back to a stable Mitula search URL. The result MUST be a valid absolute URL.
 */
function resolveUrl(clickDest: string | undefined, fallback: string): string {
  if (clickDest) {
    let decoded = "";
    try {
      decoded = Buffer.from(clickDest, "base64").toString("utf8");
    } catch {
      decoded = "";
    }
    if (decoded) {
      if (/^https?:\/\//i.test(decoded)) {
        try {
          return new URL(decoded).toString();
        } catch {
          /* fall through */
        }
      }
      const abs = absolutize(BASE, decoded);
      if (abs) return abs;
    }
  }
  return fallback;
}

/** Parse "02/03/2026 en - E&C Asesores S.A." -> agency after "en -" (null when empty). */
function parseAgency(text: string): string | null {
  const idx = text.indexOf("en -");
  if (idx < 0) return null;
  const agency = text.slice(idx + "en -".length).trim();
  return agency || null;
}

/** A single cheerio-wrapped element (the return type of `$(el)`). */
type CheerioNode = ReturnType<Cheerio>;

function normalize(card: CheerioNode, about: MitulaAboutItem | undefined, fallbackUrl: string): Listing | null {
  const id = card.attr("data-listingid") || card.attr("data-pageviewid") || null;
  const url = resolveUrl(card.attr("data-clickdestination"), fallbackUrl);
  if (!url) return null;
  if (!id) return null;

  const price = parsePriceCOP(card.attr("data-price"));
  const barrio = card.attr("data-neighbourhood")?.trim() || null;
  const city = card.attr("data-city")?.trim() || null;
  const district = card.attr("data-district")?.trim() || null;
  const bedrooms = parseIntSafe(card.attr("data-rooms") ?? null);

  // area: prefer card data-floorarea ("100 m²", may be empty), then JSON-LD floorSize.
  const area = parseArea(card.attr("data-floorarea") ?? null) ?? parseArea(about?.floorSize?.value ?? null);

  const lat = toFloat(about?.geo?.latitude);
  const lng = toFloat(about?.geo?.longitude);
  const hasGeo = lat != null && lng != null;

  // title: richer JSON-LD name when present, else build from card location.
  const title =
    about?.name?.trim() ||
    [barrio, district].filter(Boolean).map((s) => titleCase(s as string)).join(", ") ||
    null;

  const address = about?.address?.streetAddress?.trim() || null;

  // agency + publish date live in the snippet block (data-test attr).
  const snippet = card.find('[data-test="snippet__published-date-and-agency"]').text().trim();
  const agency = snippet ? parseAgency(snippet) : null;

  // bathrooms only available via JSON-LD.
  const bathrooms =
    typeof about?.numberOfBathroomsTotal === "number" ? about.numberOfBathroomsTotal : null;

  const raw = {
    id,
    price: card.attr("data-price") ?? null,
    currency: card.attr("data-currency") ?? null,
    operationType: card.attr("data-operation-type") ?? null,
    neighbourhood: barrio,
    city,
    district,
    region: card.attr("data-region") ?? null,
    location: card.attr("data-location") ?? null,
    floorarea: card.attr("data-floorarea") ?? null,
    rooms: card.attr("data-rooms") ?? null,
    snippet,
    about: about ?? null,
  };

  return {
    source: "mitula",
    sourceListingId: String(id),
    url,
    title,
    barrio: barrio ? titleCase(barrio) : null,
    conjunto: null,
    city,
    address,
    lat: hasGeo ? lat : null,
    lng: hasGeo ? lng : null,
    geocodePrecision: hasGeo ? "source" : null,
    areaM2: area,
    bedrooms,
    bathrooms,
    parking: null,
    price,
    admin: null,
    estrato: null,
    currency: "COP",
    agency,
    phone: null, // aggregator: no phone on the SERP
    hasWhatsapp: false,
    rawJson: JSON.stringify(raw),
  };
}

export const mitulaAdapter: SourceAdapter = {
  id: "mitula",
  label: "Mitula (agregador)",
  tier: "B",
  domain: "casas.mitula.com.co",

  async *fetchList(params: ResolvedCrawlParams, ctx: AdapterContext) {
    const http = new HttpClient();

    for (const city of params.cities) {
      const slug = citySlug(city);
      if (!slug) {
        ctx.log(`mitula: empty city "${city}", skipping`);
        continue;
      }
      const baseUrl = pathSlug(params.propertyType, slug);

      for (let page = 1; page <= params.maxPagesPerSource; page++) {
        if (ctx.signal?.aborted) return;
        const url = page === 1 ? baseUrl : `${baseUrl}?page=${page}`;

        let html: string;
        try {
          html = await http.getText(url, { headers: NAV_HEADERS });
        } catch (e) {
          // High pages 404 (getText throws) -> treat as end of results for this city.
          ctx.log(`mitula: ${city} page ${page} stopped: ${(e as Error).message}`);
          break;
        }

        const $ = load(html);
        const cards = $("article.listing-card");
        if (cards.length === 0) {
          ctx.log(`mitula: ${city} page ${page} -> 0 cards (end)`);
          break;
        }

        const about = extractAbout($);
        const fallbackUrl = url;
        let yielded = 0;
        const els = cards.toArray();
        for (let i = 0; i < els.length; i++) {
          const l = normalize($(els[i]), about[i], fallbackUrl);
          if (l) {
            yielded++;
            yield l;
          }
        }
        ctx.log(`mitula: ${city} page ${page} (${yielded}/${cards.length})`);
      }
    }
  },
};

export default mitulaAdapter;
