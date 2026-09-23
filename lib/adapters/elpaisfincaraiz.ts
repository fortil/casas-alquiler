import { CITIES } from "@/lib/config";
import type { Listing, ResolvedCrawlParams } from "@/lib/core/schema";
import { extractPhone, norm, parseArea, parsePriceCOP, titleCase } from "@/lib/util/text";
import { absolutize, load } from "@/lib/adapters/base/parse";
import { HttpClient } from "@/lib/adapters/base/httpClient";
import type { AdapterContext, SourceAdapter } from "@/lib/adapters/types";

const BASE = "https://fincaraiz.elpais.com.co";

const CITY_LABEL: Record<string, string> = Object.fromEntries(CITIES.map((c) => [c.slug, c.label]));

/** propertyType -> URL path segment ("/avisos/alquiler/{tipo}/{ciudad}"). */
function typeSlug(t: ResolvedCrawlParams["propertyType"]): string {
  return t === "apartamento" ? "apartamentos" : "casas";
}

function cityLabel(city: string): string {
  return CITY_LABEL[city] ?? titleCase(city.replace(/-/g, " "));
}

/** Card links end in "-vp{id}[-agencySlug]" or "-ag{id}"; both carry the numeric ad id. */
function idFromUrl(url: string): string | null {
  const m = url.match(/-(?:vp|ag)(\d+)(?:-[^/]*)?$/);
  return m ? m[1] : null;
}

/** The card description reads "{Ciudad,} {N} alcoba(s), {N} baño(s), {area}mts2". */
function bedroomsFrom(desc: string): number | null {
  const m = desc.match(/(\d+)\s*alcoba/i);
  return m ? parseInt(m[1], 10) : null;
}

function bathroomsFrom(desc: string): number | null {
  const m = desc.match(/(\d+)\s*ba[ñn]o/i);
  return m ? parseInt(m[1], 10) : null;
}

/**
 * Area is Colombian-formatted ("1.680,00mts2" = 1680 m², dot thousands +
 * comma decimal), which `parseArea` doesn't handle — it expects at most one
 * separator. Strip thousands dots before falling back to it.
 */
function areaFrom(desc: string): number | null {
  const m = desc.match(/([\d.,]+)\s*mts?2/i);
  if (!m) return null;
  const normalized = m[1].includes(",") ? m[1].replace(/\./g, "") : m[1];
  return parseArea(normalized);
}

/**
 * Card heading reads "{Tipo}, Alquiler en {Barrio}", falling back to the city
 * name when the listing has no barrio ("Barrio: Sin datos" on the detail
 * page). Treat a location that just echoes the city as "no barrio".
 */
function barrioFromHeading(h3: string, city: string): string | null {
  const m = h3.match(/Alquiler\s+en\s+(.+)$/i);
  const loc = m ? m[1].trim() : null;
  if (!loc || norm(loc) === norm(city)) return null;
  return titleCase(loc);
}

/** Parse every listing card on a search-results page (`article.flexArticle`). */
function parseCards(html: string, city: string): Listing[] {
  const $ = load(html);
  const out: Listing[] = [];

  $("article.flexArticle").each((_, el) => {
    const $card = $(el);
    const url = absolutize(BASE, $card.find("a.link-info").first().attr("href"));
    const id = url ? idFromUrl(url) : null;
    if (!url || !id) return;

    const h3 = $card.find(".label-list h3").first().text().trim();
    const desc = $card.find(".description").first().text().trim();
    const priceText = $card.find(".price").first().text().trim();

    // The wa.me "phone=" query param is present even on the rare card missing
    // the tel: link, so prefer it; fall back to the call link otherwise.
    const waHref = $card.find("a.wasa").first().attr("href");
    const telHref = $card.find("a.call").first().attr("href");
    const phone = extractPhone(waHref) ?? extractPhone(telHref);

    out.push({
      source: "elpaisfincaraiz",
      sourceListingId: id,
      url,
      title: h3 || null,
      barrio: barrioFromHeading(h3, city),
      conjunto: null,
      city,
      address: null,
      lat: null,
      lng: null,
      geocodePrecision: null,
      areaM2: areaFrom(desc),
      bedrooms: bedroomsFrom(desc),
      bathrooms: bathroomsFrom(desc),
      parking: null,
      price: parsePriceCOP(priceText),
      admin: null,
      estrato: null,
      currency: "COP",
      agency: null,
      phone,
      hasWhatsapp: !!waHref,
      rawJson: JSON.stringify({ h3, desc, priceText, waHref, telHref }),
    });
  });

  return out;
}

export const elpaisfincaraizAdapter: SourceAdapter = {
  id: "elpaisfincaraiz",
  label: "FincaRaíz El País",
  tier: "A",
  domain: "fincaraiz.elpais.com.co",

  async *fetchList(params: ResolvedCrawlParams, ctx: AdapterContext) {
    const http = new HttpClient();
    const slug = typeSlug(params.propertyType);

    for (const city of params.cities) {
      if (ctx.signal?.aborted) return;
      const label = cityLabel(city);
      const path = `${BASE}/avisos/alquiler/${slug}/${city}`;
      const maxPages = Math.max(1, params.maxPagesPerSource);

      for (let page = 1; page <= maxPages; page++) {
        if (ctx.signal?.aborted) return;
        const url = page > 1 ? `${path}?page=${page}` : path;

        let html: string;
        try {
          html = await http.getText(url);
        } catch (e) {
          ctx.log(`elpaisfincaraiz: ${city} page ${page} failed: ${(e as Error).message}`);
          break;
        }

        const listings = parseCards(html, label);
        for (const l of listings) yield l;

        ctx.log(`elpaisfincaraiz: ${city} page ${page} (${listings.length})`);

        // Out-of-range pages 404 (caught above); an in-range page with no
        // cards is the defensive fallback so we never loop forever.
        if (listings.length === 0) break;
      }
    }
  },
};

export default elpaisfincaraizAdapter;
