import { load, extractJsonLd, findJsonLdByType, extractSitemapLocs } from "@/lib/adapters/base/parse";
import { HttpClient } from "@/lib/adapters/base/httpClient";
import { norm, titleCase, parsePriceCOP, parseArea, parseIntSafe, extractPhone } from "@/lib/util/text";
import type { Listing, ResolvedCrawlParams } from "@/lib/core/schema";
import type { AdapterContext, SourceAdapter } from "@/lib/adapters/types";

const BASE = "https://inmoalfaguara.co";
const SITEMAP = `${BASE}/sitemap.xml`;
const AGENCY = "INMOBILIARIA ALFAGUARA SAS";
const WA_NUMBER = "573185007727"; // wa.me/573185007727
const PHONE = "3185007727";

/** Map our propertyType to the site's URL slug prefix. */
function slugPrefix(t: ResolvedCrawlParams["propertyType"]): string {
  return t === "apartamento" ? "apartamento-alquiler" : "casa-alquiler";
}

/**
 * Slug form: /{tipo}-{negocio}-{barrio...}-{ciudad}/{ID}
 * e.g. /casa-alquiler-conjunto-residencial-verona-jamundi/10071877
 * Returns the city token and the middle "barrio/conjunto" segment.
 */
function parseSlug(url: string): { city: string | null; id: string | null; middle: string | null } {
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/").filter(Boolean); // ["casa-alquiler-...-jamundi", "10071877"]
    if (parts.length < 2) return { city: null, id: null, middle: null };
    const id = /^\d+$/.test(parts[parts.length - 1]) ? parts[parts.length - 1] : null;
    const slug = parts[parts.length - 2];
    const toks = slug.split("-");
    if (toks.length < 3) return { city: null, id, middle: null };
    const city = toks[toks.length - 1]; // last token = ciudad
    // drop "{tipo}-{negocio}" (first two tokens) and trailing city → middle barrio/conjunto
    const middle = toks.slice(2, toks.length - 1).join(" ").trim() || null;
    return { city, id, middle };
  } catch {
    return { city: null, id: null, middle: null };
  }
}

/** True when the slug is a rental of the requested type in jamundi/cali. */
function slugMatches(url: string, prefix: string, cities: string[]): boolean {
  const path = url.replace(BASE, "");
  if (!path.includes(`/${prefix}-`)) return false;
  return cities.some((c) => path.includes(`-${c}/`));
}

/** Strip HTML tags + decode the few entities the site emits, for description text. */
function stripHtml(s: string | undefined | null): string {
  if (!s) return "";
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&ntilde;/g, "n")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The detail page renders characteristics as `<li class="col-md-8">
 * <strong>Label:</strong> value</li>` rows (País/Departamento/Ciudad/
 * Zona-barrio/Área Construida/Alcobas/Baños/Garaje/Estrato/…). Build a
 * normalized label→value map by reading the value text that trails each
 * <strong> label inside its <li>.
 */
function buildLabelMap($: ReturnType<typeof load>): Map<string, string> {
  const map = new Map<string, string>();
  $("li.col-md-8").each((_, el) => {
    const $li = $(el);
    const label = $li.find("strong").first().text().trim();
    if (!label.endsWith(":")) return;
    const key = norm(label.slice(0, -1));
    const full = $li.text().trim();
    const val = full.startsWith(label) ? full.slice(label.length).trim() : full;
    if (key && val && !map.has(key)) map.set(key, val);
  });
  return map;
}

interface HouseLd {
  url?: string;
  name?: string;
  description?: string;
  address?: string;
  geo?: { latitude?: string | number; longitude?: string | number };
  numberOfRooms?: string | number;
  telephone?: string;
}

function num(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

function parseDetail(html: string, url: string, propertyType: ResolvedCrawlParams["propertyType"]): Listing | null {
  const $ = load(html);
  const ld = findJsonLdByType(extractJsonLd($), "house") as HouseLd | null;
  const { city: citySlug, id: idSlug, middle } = parseSlug(url);
  const labels = buildLabelMap($);

  // sourceListingId = trailing /{ID}; fall back to the "Código:" cell.
  const codigo = (labels.get("codigo") ?? "").match(/\d+/)?.[0] ?? null;
  const sourceListingId = idSlug ?? codigo;
  if (!sourceListingId) return null;

  // Price: og:title carries "... - $1.100.000 COP"; fall back to the visible "Precio de alquiler" cell.
  const ogTitle = $('meta[property="og:title"]').attr("content") ?? "";
  let price = parsePriceCOP(ogTitle.includes("$") ? ogTitle.slice(ogTitle.lastIndexOf("$")) : null);
  if (price == null) {
    // value next to "Precio de alquiler" is rendered without a trailing colon; scan raw text.
    const m = $("body").text().match(/Precio de alquiler\s*\$?\s*([\d.,]+)/i);
    if (m) price = parsePriceCOP(m[1]);
  }

  const lat = num(ld?.geo?.latitude);
  const lng = num(ld?.geo?.longitude);

  const areaM2 =
    parseArea(labels.get("area construida") ?? null) ??
    parseArea(labels.get("area privada") ?? null) ??
    parseArea(labels.get("area terreno") ?? null);

  const bedrooms = parseIntSafe(labels.get("alcobas") ?? null) ?? parseIntSafe(ld?.numberOfRooms ?? null);
  const bathrooms = parseIntSafe(labels.get("banos") ?? null);
  const parking = parseIntSafe(labels.get("garaje") ?? null);

  let estrato = parseIntSafe(labels.get("estrato") ?? null);
  if (estrato != null && (estrato < 1 || estrato > 6)) estrato = null;

  const admin = parsePriceCOP(labels.get("administracion") ?? null);

  // "Zona / barrio" cell; conjunto from the slug when it names a conjunto.
  const zona = labels.get("zona / barrio") ?? labels.get("barrio") ?? null;
  const barrio = zona ? titleCase(zona) : middle ? titleCase(middle) : null;
  const conjunto = middle && /conjunto|residencial|condominio/.test(middle) ? titleCase(middle) : null;

  const cityName = labels.get("ciudad") ? titleCase(labels.get("ciudad") as string) : citySlug ? titleCase(citySlug) : null;

  const title = ld?.name?.trim() || (ogTitle ? ogTitle.split(" - $")[0].trim() : null);
  const phone = extractPhone(ld?.telephone) ?? PHONE;

  return {
    source: "inmoalfaguara",
    sourceListingId,
    url: ld?.url?.startsWith("http") ? ld.url : url,
    title: title || null,
    barrio,
    conjunto,
    city: cityName,
    address: ld?.address?.trim() || null,
    lat: lat != null ? lat : null,
    lng: lng != null ? lng : null,
    geocodePrecision: lat != null && lng != null ? "source" : null,
    areaM2,
    bedrooms,
    bathrooms,
    parking,
    price,
    admin,
    estrato,
    currency: "COP",
    agency: AGENCY,
    phone,
    hasWhatsapp: true,
    rawJson: JSON.stringify({
      url,
      ld,
      characteristics: Object.fromEntries(labels),
      ogTitle,
      wa: WA_NUMBER,
      propertyType,
    }),
  };
}

export const inmoalfaguaraAdapter: SourceAdapter = {
  id: "inmoalfaguara",
  label: "Inmobiliaria Alfaguara",
  tier: "A",
  domain: "inmoalfaguara.co",

  async *fetchList(params: ResolvedCrawlParams, ctx: AdapterContext) {
    const http = new HttpClient();
    const prefix = slugPrefix(params.propertyType);

    // Warm up the cookie jar: the detail pages only server-render the full
    // characteristics block once a session cookie is set. Best-effort.
    try {
      await http.getText(BASE);
    } catch {
      /* non-fatal */
    }

    let xml: string;
    try {
      xml = await http.getText(SITEMAP, { headers: { Accept: "application/xml,text/xml,*/*" } });
    } catch (e) {
      ctx.log(`inmoalfaguara: sitemap fetch failed: ${(e as Error).message}`);
      return;
    }

    const all = extractSitemapLocs(xml);
    const urls = all.filter((u) => slugMatches(u, prefix, params.cities));
    ctx.log(`inmoalfaguara: ${urls.length} ${prefix} listings for [${params.cities.join(", ")}]`);

    // maxPagesPerSource caps total detail fetches (no real pagination — small volume).
    const limit = params.maxPagesPerSource > 0 ? params.maxPagesPerSource * 50 : urls.length;
    let count = 0;

    for (const url of urls) {
      if (ctx.signal?.aborted) return;
      if (count >= limit) break;
      let html: string;
      try {
        html = await http.getText(url);
      } catch (e) {
        ctx.log(`inmoalfaguara: detail failed ${url}: ${(e as Error).message}`);
        continue;
      }
      try {
        const listing = parseDetail(html, url, params.propertyType);
        if (listing) {
          count++;
          yield listing;
        }
      } catch (e) {
        ctx.log(`inmoalfaguara: parse failed ${url}: ${(e as Error).message}`);
        continue;
      }
    }
    ctx.log(`inmoalfaguara: yielded ${count}`);
  },

  async fetchDetail(url: string, ctx: AdapterContext): Promise<Partial<Listing> | null> {
    const http = new HttpClient();
    try {
      const html = await http.getText(url);
      const ptype: ResolvedCrawlParams["propertyType"] = url.includes("/apartamento-") ? "apartamento" : "casa";
      return parseDetail(html, url, ptype);
    } catch (e) {
      ctx.log(`inmoalfaguara: fetchDetail failed ${url}: ${(e as Error).message}`);
      return null;
    }
  },
};

export default inmoalfaguaraAdapter;
