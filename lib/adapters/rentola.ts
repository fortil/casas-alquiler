import type { Listing, ResolvedCrawlParams } from "@/lib/core/schema";
import type { AdapterContext, SourceAdapter } from "@/lib/adapters/types";
import { HttpClient } from "@/lib/adapters/base/httpClient";
import {
  absolutize,
  extractJsonLd,
  extractSitemapLocs,
  findJsonLdByType,
  load,
} from "@/lib/adapters/base/parse";
import { parseArea, parseIntSafe, parsePriceCOP, titleCase } from "@/lib/util/text";

const BASE = "https://rentola.co.com";
const SITEMAP_INDEX = `${BASE}/server-sitemap-index.xml`;

/** robots.txt: Disallow *contact=true, /ads-map/, /api/events */
function robotsAllowed(url: string): boolean {
  if (url.includes("contact=true")) return false;
  if (url.includes("/api/events")) return false;
  if (url.includes("/ads-map/")) return false;
  return true;
}

/** Rentola spells the type the same way we do in its slugs/SRP path. */
function typeSlug(t: ResolvedCrawlParams["propertyType"]): string {
  return t === "apartamento" ? "apartamento" : "casa";
}

// ---- JSON-LD shapes (RealEstateListing -> Offer -> House) -----------------

interface LdQuantitative {
  value?: number | string;
}
interface LdGeo {
  latitude?: number | string;
  longitude?: number | string;
}
interface LdAddress {
  streetAddress?: string;
  addressLocality?: string;
  addressRegion?: string;
}
interface LdHouse {
  "@type"?: string | string[];
  address?: LdAddress;
  geo?: LdGeo;
  floorSize?: LdQuantitative;
  numberOfBedrooms?: LdQuantitative;
  numberOfBathroomsTotal?: LdQuantitative;
  numberOfBathrooms?: LdQuantitative;
}
interface LdOffer {
  price?: number | string;
  priceCurrency?: string;
  availability?: string;
  itemOffered?: LdHouse;
}
interface LdRealEstate {
  name?: string;
  description?: string;
  url?: string;
  offers?: LdOffer;
}

function num(v: number | string | undefined | null): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

// ---- slug parsing ---------------------------------------------------------

/**
 * Detail slugs look like:
 *   casa-en-arriendo-en-cali-en-villa-del-prado-99622-1-000-000-pcec8fd
 *   casa-en-arriendo-en-cali-19253-910-000-p1b3568            (no barrio)
 *   morichal-de-comfandi-casa-p72ea91                         (no id/price)
 * The trailing block is `-{id}-{price-groups}-p{hash}`.
 */
function lastSlug(url: string): string {
  try {
    const path = new URL(url).pathname.replace(/\/+$/, "");
    return path.slice(path.lastIndexOf("/") + 1);
  } catch {
    return url;
  }
}

function idFromSlug(slug: string): string | null {
  const m = slug.match(/-(\d+)-\d{1,3}(?:-\d{3})+-p[0-9a-f]+$/i);
  if (m) return m[1];
  const h = slug.match(/-p([0-9a-f]+)$/i);
  return h ? h[1] : null;
}

function cityFromSlug(slug: string): string | null {
  const m = slug.match(/-en-(cali|jamundi)\b/i);
  return m ? m[1].toLowerCase() : null;
}

function barrioFromSlug(slug: string): string | null {
  // ...-en-{city}-en-{barrio}-{id}-{price}-p{hash}
  const m = slug.match(/-en-(?:cali|jamundi)-en-(.+?)-\d{1,7}-\d{1,3}(?:-\d{3})+-p[0-9a-f]+$/i);
  if (!m) return null;
  const b = m[1].replace(/-/g, " ").trim();
  return b ? titleCase(b) : null;
}

// ---- detail HTML panel fallbacks -----------------------------------------

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function panelBedrooms(text: string): number | null {
  const m = text.match(/Habitaciones\s+(\d+)/);
  return m ? parseIntSafe(m[1]) : null;
}

function panelArea(text: string): number | null {
  const m = text.match(/Tama[ñn]o\s+(\d+(?:[.,]\d+)?)\s*m/);
  return m ? parseArea(m[1]) : null;
}

function panelHasParking(text: string): boolean {
  // The panel renders "Parking</p><p>Sí</p>" -> "Parking Sí" after stripTags.
  // Note: no trailing \b — "í" is not a JS word char, so \b after it never matches.
  return /(?:Parking|Garaje|Parqueadero)\s+S[íi](?:\s|$)/.test(text);
}

// ---- normalization --------------------------------------------------------

function normalizeDetail(url: string, html: string): Listing | null {
  const slug = lastSlug(url);
  const sourceListingId = idFromSlug(slug);
  if (!sourceListingId) return null;

  const $ = load(html);
  const ld = findJsonLdByType(extractJsonLd($), "RealEstateListing") as LdRealEstate | null;
  const offer = ld?.offers ?? undefined;
  const house = offer?.itemOffered ?? undefined;
  const addr = house?.address ?? undefined;
  const geo = house?.geo ?? undefined;

  const text = stripTags(html);

  const price = parsePriceCOP(offer?.price ?? null);
  const lat = num(geo?.latitude);
  const lng = num(geo?.longitude);
  const hasCoords = lat != null && lng != null;

  const area = num(house?.floorSize?.value) ?? panelArea(text);
  const bedrooms =
    parseIntSafe(house?.numberOfBedrooms?.value ?? null) ?? panelBedrooms(text);
  const bathrooms = parseIntSafe(
    house?.numberOfBathroomsTotal?.value ?? house?.numberOfBathrooms?.value ?? null,
  );

  // City comes from the slug (the geocoded addressLocality is sometimes wrong).
  const citySlug = cityFromSlug(slug);
  const city = citySlug ? titleCase(citySlug) : addr?.addressLocality?.trim() || null;
  const barrio = barrioFromSlug(slug);

  return {
    source: "rentola",
    sourceListingId,
    url: ld?.url || url,
    title: ld?.name?.trim() || null,
    barrio,
    conjunto: null,
    city,
    address: addr?.streetAddress?.trim() || null,
    lat: hasCoords ? lat : null,
    lng: hasCoords ? lng : null,
    geocodePrecision: hasCoords ? "source" : null,
    areaM2: area && area > 0 ? area : null,
    bedrooms,
    bathrooms,
    parking: panelHasParking(text) ? 1 : null,
    price,
    admin: null, // not exposed by Rentola
    estrato: null, // not exposed by Rentola
    currency: "COP",
    agency: null, // opaque
    phone: null, // gated behind contact form
    hasWhatsapp: false,
    rawJson: JSON.stringify(ld ?? { url, slug }),
  };
}

// ---- list discovery -------------------------------------------------------

/** Pull initial `/listings/...` detail links from the server-rendered SRP. */
function listingLinksFromSrp(html: string): string[] {
  const $ = load(html);
  const out = new Set<string>();
  $('a[href*="/listings/"]').each((_, el) => {
    const href = $(el).attr("href");
    const abs = absolutize(BASE, href);
    if (abs && /\/listings\//.test(abs) && robotsAllowed(abs)) out.add(abs);
  });
  return [...out];
}

/**
 * Enumerate the listing sitemaps and return detail URLs for the given city +
 * property type. Slugs embed `-en-{city}-` and start with the type word.
 */
async function listingsFromSitemaps(
  http: HttpClient,
  city: string,
  type: string,
  ctx: AdapterContext,
): Promise<string[]> {
  let indexXml: string;
  try {
    indexXml = await http.getText(SITEMAP_INDEX);
  } catch (e) {
    ctx.log(`rentola: sitemap index failed: ${(e as Error).message}`);
    return [];
  }
  const sub = extractSitemapLocs(indexXml).filter((u) => /server-sitemap-listings\//.test(u));
  const out = new Set<string>();
  const cityToken = `-en-${city}-`;
  for (const sm of sub) {
    if (ctx.signal?.aborted) break;
    let xml: string;
    try {
      xml = await http.getText(sm);
    } catch (e) {
      ctx.log(`rentola: ${sm} failed: ${(e as Error).message}`);
      continue;
    }
    for (const loc of extractSitemapLocs(xml)) {
      if (!robotsAllowed(loc)) continue;
      if (!/\/listings\//.test(loc)) continue;
      const slug = lastSlug(loc);
      if (!slug.toLowerCase().includes(cityToken)) continue;
      if (!slug.toLowerCase().startsWith(`${type}-`)) continue;
      out.add(loc);
    }
  }
  return [...out];
}

export const rentolaAdapter: SourceAdapter = {
  id: "rentola",
  label: "Rentola",
  tier: "A",
  domain: "rentola.co.com",

  async *fetchList(params: ResolvedCrawlParams, ctx: AdapterContext) {
    const http = new HttpClient();
    const type = typeSlug(params.propertyType);
    const maxDetails = Math.max(1, params.maxPagesPerSource) * 30;

    for (const city of params.cities) {
      if (ctx.signal?.aborted) return;
      const cityKey = city.toLowerCase();
      if (cityKey !== "cali" && cityKey !== "jamundi") {
        ctx.log(`rentola: unsupported city "${city}", skipping`);
        continue;
      }

      // 1) initial batch from the server-rendered SRP
      const detailUrls = new Set<string>();
      const srp = `${BASE}/arriendo/${type}/${cityKey}`;
      try {
        const html = await http.getText(srp);
        for (const u of listingLinksFromSrp(html)) detailUrls.add(u);
        ctx.log(`rentola: ${cityKey} SRP yielded ${detailUrls.size} links`);
      } catch (e) {
        ctx.log(`rentola: ${cityKey} SRP failed: ${(e as Error).message}`);
      }

      // 2) supplement with the sitemap (the SRP is infinite-scroll)
      if (detailUrls.size < maxDetails && !ctx.signal?.aborted) {
        try {
          const fromSm = await listingsFromSitemaps(http, cityKey, type, ctx);
          for (const u of fromSm) detailUrls.add(u);
          ctx.log(`rentola: ${cityKey} total ${detailUrls.size} detail urls after sitemap`);
        } catch (e) {
          ctx.log(`rentola: ${cityKey} sitemap enumeration failed: ${(e as Error).message}`);
        }
      }

      // 3) fetch + parse details, capped
      let fetched = 0;
      for (const url of detailUrls) {
        if (ctx.signal?.aborted) return;
        if (fetched >= maxDetails) {
          ctx.log(`rentola: ${cityKey} hit detail cap (${maxDetails})`);
          break;
        }
        if (!robotsAllowed(url)) continue;
        fetched++;
        try {
          const html = await http.getText(url);
          const listing = normalizeDetail(url, html);
          if (listing) yield listing;
        } catch (e) {
          ctx.log(`rentola: detail failed ${url}: ${(e as Error).message}`);
          continue;
        }
      }
      ctx.log(`rentola: ${cityKey} fetched ${fetched} details`);
    }
  },

  async fetchDetail(url: string, ctx: AdapterContext): Promise<Partial<Listing> | null> {
    if (!robotsAllowed(url)) return null;
    const http = new HttpClient();
    try {
      const html = await http.getText(url);
      return normalizeDetail(url, html);
    } catch (e) {
      ctx.log(`rentola: fetchDetail failed ${url}: ${(e as Error).message}`);
      return null;
    }
  },
};

export default rentolaAdapter;
