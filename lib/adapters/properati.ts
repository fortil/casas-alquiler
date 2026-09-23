import { DEPARTMENT_SLUG } from "@/lib/config";
import type { Listing, ResolvedCrawlParams } from "@/lib/core/schema";
import type { AdapterContext, SourceAdapter } from "@/lib/adapters/types";
import { HttpClient } from "@/lib/adapters/base/httpClient";
import {
  absolutize,
  extractJsonLd,
  findJsonLdByType,
  load,
  type Cheerio,
} from "@/lib/adapters/base/parse";
import {
  extractPhone,
  norm,
  parseArea,
  parseIntSafe,
  parsePriceCOP,
  titleCase,
} from "@/lib/util/text";

const BASE = "https://www.properati.com.co";
const ES_HEADERS = { "Accept-Language": "es-CO,es;q=0.9,en;q=0.8" };

/** Shape of a House/Apartment node inside SearchResultsPage.about[]. */
interface LdAbout {
  "@type"?: string;
  name?: string;
  numberOfBedrooms?: number | string;
  numberOfBathroomsTotal?: number | string;
  address?: {
    streetAddress?: string;
    addressLocality?: string;
    addressRegion?: string;
  };
  floorSize?: { value?: number | string };
  geo?: { latitude?: number | string; longitude?: number | string };
  image?: string;
}

interface LdSearchPage {
  about?: LdAbout[];
}

/** One SSR card scraped from the list page, aligned 1:1 by index with about[]. */
interface CardData {
  url: string | null;
  id: string | null;
  title: string | null;
  price: number | null;
  areaM2: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  agency: string | null;
}

/** Map our propertyType to Properati's URL slug. */
function typeSlug(t: ResolvedCrawlParams["propertyType"]): string {
  return t === "apartamento" ? "apartamento" : "casa";
}

/** Build a list URL. Page 1 has no suffix; pages >=2 append /<n> (NO query string). */
function listUrl(city: string, type: string, page: number): string {
  const path = `/s/${city}-${DEPARTMENT_SLUG}/${type}/arriendo`;
  return `${BASE}${path}${page > 1 ? `/${page}` : ""}`;
}

/** "/detalle/<id>" -> "<id>" (the path tail is the stable source id). */
function idFromUrl(url: string | null): string | null {
  if (!url) return null;
  const m = url.match(/\/detalle\/([^/?#]+)/);
  return m ? m[1] : null;
}

/** Parse a single number from messy text, accepting es-CO comma decimals. */
function num(v: number | string | undefined): number | null {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const n = parseFloat(v.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/**
 * Pull the barrio out of a card title like "Casa en Arriendo en Santa Isabel".
 * Returns null when the trailing token is just the city itself.
 */
function barrioFromTitle(title: string | null, city: string): string | null {
  if (!title) return null;
  const m = title.match(/\barriendo\s+en\s+(.+)$/i);
  if (!m) return null;
  const cand = m[1].trim();
  if (!cand || norm(cand) === norm(city)) return null;
  return titleCase(cand);
}

/**
 * Parse the streetAddress for a barrio (the segment just before the city) and
 * a conjunto (a leading "Conjunto …" segment). Format observed:
 *   "[Conjunto X,] [street,] [<barrio>,] <City>, Valle del Cauca, <Country>"
 */
function parseStreetAddress(
  street: string | null | undefined,
  city: string,
): { barrio: string | null; conjunto: string | null } {
  if (!street) return { barrio: null, conjunto: null };
  const parts = street
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);

  const conjunto = parts.find((p) => /^conjunto\b/i.test(p)) ?? null;

  // Drop trailing country + region + the city itself.
  const cityNorm = norm(city);
  let tail = parts.slice();
  // remove country
  if (tail.length && /^(colombia|col)$/i.test(tail[tail.length - 1])) tail.pop();
  // remove region (valle del cauca)
  if (tail.length && norm(tail[tail.length - 1]) === norm(DEPARTMENT_SLUG.replace(/-/g, " ")))
    tail.pop();
  // remove city
  if (tail.length && norm(tail[tail.length - 1]) === cityNorm) tail.pop();

  // The remaining last segment is a barrio candidate only when it is not a
  // street-style token (no leading "Calle/Carrera/Cra/Cl/Av/#/digits").
  const last = tail[tail.length - 1] ?? null;
  const isStreety =
    !!last &&
    (/\d/.test(last) ||
      /^(calle|carrera|cra\.?|cl\.?|av\.?|avenida|cr\.?|kr\.?|diagonal|dg\.?|transversal|tv\.?|autopista)\b/i.test(
        last,
      ) ||
      /^conjunto\b/i.test(last));
  const barrio = last && !isStreety ? titleCase(last) : null;

  return { barrio, conjunto: conjunto ? titleCase(conjunto) : null };
}

/** Scrape the 30 SSR cards in DOM order (aligned 1:1 with JSON-LD about[]). */
function scrapeCards($: Cheerio): CardData[] {
  const cards: CardData[] = [];
  $('div.snippet__content[data-maincontent="true"]').each((_, el) => {
    const card = $(el);
    const anchor = card.find('a[data-test="snippet__title"]').first();
    const href = anchor.attr("href") ?? null;
    const url = absolutize(BASE, href);
    const title = (anchor.attr("title") || anchor.text() || "").trim() || null;
    const priceTxt = card.find('[data-test="snippet__price"]').first().text();
    const areaTxt = card.find('[data-test="area-value"]').first().text();
    const bedsTxt = card.find('[data-test="bedrooms-value"]').first().text();
    const bathsTxt = card.find('[data-test="full-bathrooms-value"]').first().text();
    const agency =
      card.find('[data-test="agency-name"]').first().text().trim() ||
      card.find(".wl-agency-logo img").first().attr("alt")?.trim() ||
      "";

    cards.push({
      url,
      id: idFromUrl(url),
      title,
      price: parsePriceCOP(priceTxt),
      areaM2: parseArea(areaTxt),
      bedrooms: parseIntSafe(bedsTxt),
      bathrooms: parseIntSafe(bathsTxt),
      agency: agency || null,
    });
  });
  return cards;
}

function normalize(card: CardData, ld: LdAbout | undefined, city: string): Listing | null {
  // url is REQUIRED — drop cards we cannot link to.
  if (!card.url || !card.id) return null;

  const street = ld?.address?.streetAddress ?? null;
  const fromStreet = parseStreetAddress(street, city);
  const barrio = barrioFromTitle(card.title, city) ?? fromStreet.barrio;

  const lat = num(ld?.geo?.latitude);
  const lng = num(ld?.geo?.longitude);
  const hasGeo = lat != null && lng != null;

  // Card data is the richer source for beds/baths/area; fall back to JSON-LD.
  const areaM2 = card.areaM2 ?? num(ld?.floorSize?.value);
  const bedrooms = card.bedrooms ?? (ld?.numberOfBedrooms != null ? parseIntSafe(String(ld.numberOfBedrooms)) : null);
  const bathrooms =
    card.bathrooms ??
    (ld?.numberOfBathroomsTotal != null ? parseIntSafe(String(ld.numberOfBathroomsTotal)) : null);

  return {
    source: "properati",
    sourceListingId: card.id,
    url: card.url,
    title: card.title ?? ld?.name ?? null,
    barrio: barrio || null,
    conjunto: fromStreet.conjunto,
    city: ld?.address?.addressLocality?.trim() || titleCase(city),
    address: street?.trim() || null,
    lat: hasGeo ? lat : null,
    lng: hasGeo ? lng : null,
    geocodePrecision: hasGeo ? "source" : null,
    areaM2: areaM2 != null && areaM2 > 0 ? areaM2 : null,
    bedrooms,
    bathrooms,
    parking: null,
    price: card.price,
    admin: null,
    estrato: null,
    currency: "COP",
    agency: card.agency,
    phone: null,
    hasWhatsapp: false,
    rawJson: JSON.stringify({ card, ld: ld ?? null }),
  };
}

export const properatiAdapter: SourceAdapter = {
  id: "properati",
  label: "Properati",
  tier: "A",
  domain: "properati.com.co",

  async *fetchList(params: ResolvedCrawlParams, ctx: AdapterContext) {
    const http = new HttpClient();
    const type = typeSlug(params.propertyType);

    for (const city of params.cities) {
      for (let page = 1; page <= params.maxPagesPerSource; page++) {
        if (ctx.signal?.aborted) return;
        const url = listUrl(city, type, page);

        let html: string;
        try {
          html = await http.getText(url, { headers: ES_HEADERS });
        } catch (e) {
          ctx.log(`properati: ${city} page ${page} failed: ${(e as Error).message}`);
          break;
        }

        let cards: CardData[];
        let about: LdAbout[];
        try {
          const $ = load(html);
          cards = scrapeCards($);
          const srp = findJsonLdByType(extractJsonLd($), "SearchResultsPage") as LdSearchPage | null;
          about = Array.isArray(srp?.about) ? (srp!.about as LdAbout[]) : [];
        } catch (e) {
          ctx.log(`properati: ${city} page ${page} parse error: ${(e as Error).message}`);
          break;
        }

        if (cards.length === 0) {
          ctx.log(`properati: ${city} page ${page} empty, stopping`);
          break;
        }

        let yielded = 0;
        for (let i = 0; i < cards.length; i++) {
          const listing = normalize(cards[i], about[i], city);
          if (listing) {
            yield listing;
            yielded++;
          }
        }
        ctx.log(`properati: ${city} page ${page} (${yielded}/${cards.length})`);
      }
    }
  },

  /**
   * Enrich a /detalle/ page with agency name + phone. The "Ver teléfono" gate is
   * cosmetic: the number sits in the DOM inside .phone-number > span.
   */
  async fetchDetail(url: string, ctx: AdapterContext): Promise<Partial<Listing> | null> {
    const http = new HttpClient();
    let html: string;
    try {
      html = await http.getText(url, { headers: ES_HEADERS });
    } catch (e) {
      ctx.log(`properati: detail ${url} failed: ${(e as Error).message}`);
      return null;
    }

    const $ = load(html);
    const phoneTxt = $(".phone-number span").first().text() || $(".phone-number").first().text();
    const phone = extractPhone(phoneTxt) ?? extractPhone($("body").text());
    const agency = $(".agency-name").first().text().trim() || null;
    const hasWhatsapp =
      $('.chat-button.whatsapp').not(".disabled").length > 0 ||
      /api\.whatsapp\.com|wa\.me/.test(html);

    const out: Partial<Listing> = { hasWhatsapp };
    if (phone) out.phone = phone;
    if (agency) out.agency = agency;
    return out;
  },
};

export default properatiAdapter;
