import { load, extractSitemapLocs } from "@/lib/adapters/base/parse";
import { HttpClient } from "@/lib/adapters/base/httpClient";
import { norm, titleCase, parsePriceCOP, parseArea, parseIntSafe } from "@/lib/util/text";
import type { Listing, ResolvedCrawlParams } from "@/lib/core/schema";
import type { AdapterContext, SourceAdapter } from "@/lib/adapters/types";

const BASE = "https://arriendo.com/co";
const SITEMAP_INDEX = `${BASE}/sitemap_index.xml`;

/** Map our propertyType to the site's URL slug segment. */
function typeSlug(t: ResolvedCrawlParams["propertyType"]): string {
  return t === "apartamento" ? "apartamentos" : "casas";
}

/**
 * Slug form: /co/{tipo}/{ciudad}/{barrio}/{AR-ID}/
 * e.g. /co/apartamentos/jamundi/caminos-de-pangola/AR-499965/
 */
function parseSlug(url: string): { tipo: string | null; city: string | null; barrio: string | null; id: string | null } {
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.length < 4) return { tipo: null, city: null, barrio: null, id: null };
    const idSeg = parts[parts.length - 1];
    const id = /^AR-\d+$/i.test(idSeg) ? idSeg.toUpperCase() : null;
    return {
      tipo: parts[parts.length - 4],
      city: parts[parts.length - 3],
      barrio: parts[parts.length - 2],
      id,
    };
  } catch {
    return { tipo: null, city: null, barrio: null, id: null };
  }
}

/** True when the sitemap URL is a rental listing of the requested type in one of the target cities. */
function slugMatches(url: string, prefix: string, cities: string[]): boolean {
  const { tipo, city } = parseSlug(url);
  return tipo === prefix && !!city && cities.includes(city);
}

/**
 * Estatik renders each characteristic as `<li class="es-property-field ...">
 * <span class="es-property-field__label">Label:</span><span class="es-property-field__value">value</span></li>`.
 * Build a normalized label→value map, same approach as inmoalfaguara.
 */
function buildFieldMap($: ReturnType<typeof load>): Map<string, string> {
  const map = new Map<string, string>();
  $("li.es-property-field").each((_, el) => {
    const $li = $(el);
    let label = $li.find(".es-property-field__label").first().text().trim();
    if (label.endsWith(":")) label = label.slice(0, -1).trim();
    const value = $li.find(".es-property-field__value").first().text().trim();
    const key = norm(label);
    if (key && value && !map.has(key)) map.set(key, value);
  });
  return map;
}

/** `window.ARX_PHONE_DATA = window.ARX_PHONE_DATA || {"pc":"...","pw":"...","hc":bool,"hw":bool};` */
function parsePhoneData(html: string): { phone: string | null; hasWhatsapp: boolean } {
  const m = html.match(/ARX_PHONE_DATA\s*=\s*window\.ARX_PHONE_DATA\s*\|\|\s*(\{[^}]*\})/);
  if (!m) return { phone: null, hasWhatsapp: false };
  try {
    const data = JSON.parse(m[1]) as { pc?: string; pw?: string; hc?: boolean; hw?: boolean };
    const wa = data.pw && /\d{7,}/.test(data.pw) ? data.pw : null;
    const call = data.pc && /\d{7,}/.test(data.pc) ? data.pc : null;
    return { phone: wa ?? call ?? null, hasWhatsapp: !!data.hw && !!wa };
  } catch {
    return { phone: null, hasWhatsapp: false };
  }
}

/** `window.arxPropertyLatLng = {"lat":N,"lng":N,"title":"..."};` — this listing's own coordinates. */
function parseLatLng(html: string): { lat: number | null; lng: number | null } {
  const m = html.match(/arxPropertyLatLng\s*=\s*(\{.*?\});/s);
  if (!m) return { lat: null, lng: null };
  try {
    const data = JSON.parse(m[1]) as { lat?: number; lng?: number };
    const lat = typeof data.lat === "number" && Number.isFinite(data.lat) ? data.lat : null;
    const lng = typeof data.lng === "number" && Number.isFinite(data.lng) ? data.lng : null;
    return { lat, lng };
  } catch {
    return { lat: null, lng: null };
  }
}

function parseDetail(html: string, url: string): Listing | null {
  const $ = load(html);
  const { city: citySlug, barrio: barrioSlug, id: idSlug } = parseSlug(url);

  const sourceListingId = idSlug ?? $("body").text().match(/C[oó]digo del inmueble:\s*(AR-\d+)/i)?.[1]?.toUpperCase() ?? null;
  if (!sourceListingId) return null;

  const fields = buildFieldMap($);

  const price = parsePriceCOP($(".es-price-container .es-price").first().text());
  const adminText = $(".es-price-container p strong").first().text().trim();
  const admin = /no disponible/i.test(adminText) ? null : parsePriceCOP(adminText);

  const areaM2 = parseArea(fields.get(norm("Área, m²")) ?? null);
  const bedrooms = parseIntSafe(fields.get("habitaciones") ?? null);
  const bathrooms = parseIntSafe(fields.get(norm("Baños")) ?? null);
  const parking = parseIntSafe(fields.get("parqueaderos") ?? null);

  let estrato = parseIntSafe(fields.get("estrato") ?? null);
  if (estrato != null && (estrato < 1 || estrato > 6)) estrato = null;

  const { phone, hasWhatsapp } = parsePhoneData(html);
  const { lat, lng } = parseLatLng(html);

  const agencyText = $(".intro-info-agencia p").first().text().trim();
  const agency = agencyText && !/no asignada/i.test(agencyText) ? agencyText : null;

  const barrio = fields.get("barrio") ? titleCase(fields.get("barrio") as string) : barrioSlug ? titleCase(barrioSlug.replace(/-/g, " ")) : null;
  const city = citySlug ? titleCase(citySlug) : null;

  const title = $("h1.property-title").first().text().trim() || $("h1").first().text().trim() || null;

  return {
    source: "arriendo",
    sourceListingId,
    url,
    title: title || null,
    barrio,
    conjunto: null,
    city,
    address: null,
    lat,
    lng,
    geocodePrecision: lat != null && lng != null ? "source" : null,
    areaM2,
    bedrooms,
    bathrooms,
    parking,
    price,
    admin,
    estrato,
    currency: "COP",
    agency,
    phone,
    hasWhatsapp,
    rawJson: JSON.stringify({ url, fields: Object.fromEntries(fields), adminText, agencyText }),
  };
}

export const arriendoAdapter: SourceAdapter = {
  id: "arriendo",
  label: "Arriendo.com",
  tier: "A",
  domain: "arriendo.com",

  async *fetchList(params: ResolvedCrawlParams, ctx: AdapterContext) {
    const http = new HttpClient();
    const prefix = typeSlug(params.propertyType);

    let indexXml: string;
    try {
      indexXml = await http.getText(SITEMAP_INDEX, { via: "auto", headers: { Accept: "application/xml,text/xml,*/*" } });
    } catch (e) {
      ctx.log(`arriendo: sitemap index fetch failed: ${(e as Error).message}`);
      return;
    }

    const propertySitemaps = extractSitemapLocs(indexXml).filter((u) => /properties-sitemap/i.test(u));
    if (propertySitemaps.length === 0) {
      ctx.log("arriendo: no properties-sitemap entries found in sitemap index");
      return;
    }

    // Sitemap files run ~3MB each; process one at a time and start yielding
    // immediately so a small maxPagesPerSource cap can stop before downloading
    // the rest, instead of accumulating every sitemap's URLs up front.
    const limit = params.maxPagesPerSource > 0 ? params.maxPagesPerSource * 50 : Infinity;
    let count = 0;

    for (const sitemapUrl of propertySitemaps) {
      if (ctx.signal?.aborted) return;
      if (count >= limit) break;
      let xml: string;
      try {
        xml = await http.getText(sitemapUrl, { via: "auto", headers: { Accept: "application/xml,text/xml,*/*" } });
      } catch (e) {
        ctx.log(`arriendo: ${sitemapUrl} fetch failed: ${(e as Error).message}`);
        continue;
      }
      const locs = extractSitemapLocs(xml).filter((u) => slugMatches(u, prefix, params.cities));
      ctx.log(`arriendo: ${sitemapUrl} — ${locs.length} ${prefix} matches for [${params.cities.join(", ")}]`);

      for (const url of locs) {
        if (ctx.signal?.aborted) return;
        if (count >= limit) break;
        let html: string;
        try {
          html = await http.getText(url, { via: "auto" });
        } catch (e) {
          ctx.log(`arriendo: detail failed ${url}: ${(e as Error).message}`);
          continue;
        }
        try {
          const listing = parseDetail(html, url);
          if (listing) {
            count++;
            yield listing;
          }
        } catch (e) {
          ctx.log(`arriendo: parse failed ${url}: ${(e as Error).message}`);
          continue;
        }
      }
    }
    ctx.log(`arriendo: yielded ${count}`);
  },

  async fetchDetail(url: string, ctx: AdapterContext): Promise<Partial<Listing> | null> {
    const http = new HttpClient();
    try {
      const html = await http.getText(url, { via: "auto" });
      return parseDetail(html, url);
    } catch (e) {
      ctx.log(`arriendo: fetchDetail failed ${url}: ${(e as Error).message}`);
      return null;
    }
  },
};

export default arriendoAdapter;
