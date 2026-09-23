import { load, absolutize } from "@/lib/adapters/base/parse";
import { HttpClient } from "@/lib/adapters/base/httpClient";
import { norm, titleCase, parseIntSafe, extractPhone } from "@/lib/util/text";
import type { Listing, ResolvedCrawlParams } from "@/lib/core/schema";
import type { AdapterContext, SourceAdapter } from "@/lib/adapters/types";

const BASE = "https://century21colombia.com";
const HOST = "century21colombia.com";
const DIRECTORIO = `${BASE}/directorio`;
/** Suggest/autocomplete endpoint the site's own search box calls. Unlike
 *  /busqueda (robots-disallowed) it is crawlable, but returns ≤20 matches
 *  per query — used only as extra discovery seeds. */
const SUGGEST = `${BASE}/search`;

/**
 * Site layout notes (verified live):
 *  - robots.txt disallows /busqueda (+PDF paths) for every agent; the public
 *    sitemap.xml only holds removed listings (IDs ≤ ~101k, all 404 — live
 *    inventory is ~147k–151k), so neither is a usable list source.
 *  - /directorio is server-rendered: office name, tel: link and a link-ofi to
 *    /inmobiliaria/{id}-{slug} per office.
 *  - /propiedad/{id}_{slug} server-renders every core field as meta tags:
 *    colonia (barrio), municipio, banio, recamaras, estacionamiento, precio,
 *    moneda, MT (m² terreno), MC (m² construidos); <title> is
 *    "Renta de Casa en {colonia}, {municipio}, {estado} | ID: {id}".
 *  - The site rate-limits hard at IP level, so every request goes through the
 *    throttled HttpClient with via:"auto" (Bright Data fallback).
 */

/** Map our propertyType to the site's property nouns (from "Renta de X en..."). */
function typeTokens(t: ResolvedCrawlParams["propertyType"]): string[] {
  return t === "apartamento" ? ["departamento", "apartaestudio"] : ["casa"];
}

interface SuggestItem {
  id?: number;
  tipoOperacion?: string;
  subtipoPropiedad?: string;
  nombreOficina?: string;
  municipio?: string;
  url?: string; // "/propiedad/{id}_{slug}"
}

/** Parsed detail + the operation/type tags used for request filtering. */
export interface ParsedDetail {
  listing: Listing;
  op: string | null; // "renta" | "venta" | null
  type: string | null; // "casa" | "departamento" | ...
}

/**
 * SSRF guard: server-side fetches only allow http(s) URLs on this adapter's
 * own host. Anything else (other schemes, localhost, loopback/private/reserved
 * addresses, foreign hosts) is rejected before any request is made.
 */
export function safeSiteUrl(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url, BASE);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  const h = u.hostname.toLowerCase().replace(/\.$/, "");
  if (h !== HOST && !h.endsWith(`.${HOST}`)) return null;
  return u.toString();
}

function parseFloatSafe(v: string | null | undefined): number | null {
  if (v == null) return null;
  const n = parseFloat(v.replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Parse a /propiedad/ detail page from its server-rendered meta tags. */
export function parseDetail(html: string, url: string): ParsedDetail | null {
  const $ = load(html);
  const meta = (name: string): string | null => {
    let out: string | null = null;
    $("meta[name]").each((_, el) => {
      const $el = $(el);
      if ($el.attr("name") === name && out == null) out = $el.attr("content")?.trim() ?? null;
    });
    return out;
  };

  const fullTitle = $("title").text().trim();
  // "Renta de Casa en Primero de Mayo, Cali, Valle del Cauca | ID: 150916"
  const opMatch = fullTitle.match(/^(renta|venta)\s+de\s+([a-zñáéíóú]+)\s+en\b/i);
  const op = opMatch ? norm(opMatch[1]) : null;
  const type = opMatch ? norm(opMatch[2]) : null;

  const idFromUrl = url.match(/\/propiedad\/(\d+)_?/)?.[1] ?? null;
  const sourceListingId = idFromUrl ?? parseIntSafe(meta("clave"))?.toString() ?? null;
  if (!sourceListingId) return null;

  const canonical = $('link[rel="canonical"]').attr("href");
  const finalUrl = (canonical ? safeSiteUrl(canonical) : null) ?? url;

  const title = $('meta[property="og:title"]').attr("content")?.trim() || null;
  const description = $('meta[property="og:description"]').attr("content")?.trim() || null;
  const city = meta("municipio") || fullTitle.match(/\ben\s+[^,]+,\s*([^,]+),/)?.[1]?.trim() || null;

  const listing: Listing = {
    source: "century21",
    sourceListingId,
    url: finalUrl,
    title,
    barrio: meta("colonia") ? titleCase(meta("colonia")) : null,
    conjunto: null,
    city: city ? titleCase(city) : null,
    address: null,
    lat: null,
    lng: null,
    geocodePrecision: null,
    areaM2: parseFloatSafe(meta("MC")) ?? parseFloatSafe(meta("MT")),
    bedrooms: parseIntSafe(meta("recamaras")),
    bathrooms: parseIntSafe(meta("banio")),
    parking: parseIntSafe(meta("estacionamiento")),
    price: parseIntSafe(meta("precio")),
    admin: null,
    estrato: null,
    currency: meta("moneda") || "COP",
    agency: null, // enriched by the caller (office directory / suggest seed)
    phone: null,
    hasWhatsapp: false,
    rawJson: JSON.stringify({
      url,
      estado: meta("estado"),
      mt: meta("MT"),
      mc: meta("MC"),
      medioBanio: meta("mediobanio"),
      clave: meta("clave"),
      description,
    }),
  };
  return { listing, op, type };
}

interface OfficeInfo {
  phones: Map<string, string>; // norm(office name) → phone
  pages: { url: string; name: string }[]; // /inmobiliaria/ pages
}

/** One /directorio fetch → office phones + office page links (server-rendered). */
async function fetchOffices(http: HttpClient, ctx: AdapterContext): Promise<OfficeInfo> {
  const info: OfficeInfo = { phones: new Map(), pages: [] };
  let html: string;
  try {
    html = await http.getText(DIRECTORIO, { via: "auto", timeoutMs: 15000 });
  } catch (e) {
    ctx.log(`century21: directorio fetch failed: ${(e as Error).message}`);
    return info;
  }
  const $ = load(html);
  $("div.oficina").each((_, el) => {
    const $el = $(el);
    const tel = $el.find("a[href^='tel:']").attr("href")?.replace("tel:", "").trim();
    // Text layout: "City, State - OFFICE NAME - phone - email Ver Detalle"
    const parts = $el.text().split(" - ");
    const name = parts.length >= 2 ? parts[1].replace(/Ver Detalle.*$/i, "").trim() : "";
    if (name && tel) info.phones.set(norm(name), extractPhone(tel) ?? tel);
    const pageHref = $el.find("a.link-ofi").attr("href");
    const abs = pageHref ? absolutize(BASE, pageHref) : null;
    if (abs && safeSiteUrl(abs)) info.pages.push({ url: abs.split("?")[0], name });
  });
  return info;
}

/** /propiedad/ URLs linked from an office page (id-only or id_slug forms). */
function extractOfficeListings(html: string, base: string): string[] {
  const $ = load(html);
  const urls: string[] = [];
  $("a[href]").each((_, el) => {
    const abs = absolutize(base, $(el).attr("href"));
    if (abs && /\/propiedad\/\d+(_|$|\?)/.test(abs)) urls.push(abs.split("?")[0]);
  });
  return [...new Set(urls)];
}

export const century21Adapter: SourceAdapter = {
  id: "century21",
  label: "Century 21 Colombia",
  tier: "B",
  domain: "century21colombia.com",

  async *fetchList(params: ResolvedCrawlParams, ctx: AdapterContext) {
    const http = new HttpClient();
    const cities = params.cities.map(norm);
    const types = typeTokens(params.propertyType);
    const limit =
      params.maxPerSource > 0
        ? params.maxPerSource
        : params.maxPagesPerSource > 0
          ? params.maxPagesPerSource * 20
          : Infinity;

    const offices = await fetchOffices(http, ctx);
    ctx.log(`century21: ${offices.phones.size} oficinas con teléfono, ${offices.pages.length} páginas de oficina`);

    // Candidate detail URLs. Office pages server-render a random sample of ~9
    // of that office's listings per load (no pagination), so we sample in
    // rounds: every city office once per round + one non-city office rotating,
    // stopping early when a whole round adds nothing new.
    const candidates = new Map<string, string | undefined>(); // url → agency hint
    const isCity = (o: { url: string }) => cities.some((c) => norm(o.url).includes(c));
    const cityOffices = offices.pages.filter(isCity);
    const otherOffices = offices.pages.filter((o) => !isCity(o));
    const rounds = Math.max(1, params.maxPagesPerSource);
    let otherIdx = 0;

    for (let round = 1; round <= rounds; round++) {
      if (ctx.signal?.aborted) return;
      const batch = [...cityOffices];
      if (otherOffices.length) batch.push(otherOffices[otherIdx++ % otherOffices.length]);
      const before = candidates.size;
      for (const office of batch) {
        if (ctx.signal?.aborted) return;
        try {
          const html = await http.getText(office.url, { via: "auto", timeoutMs: 15000 });
          const found = extractOfficeListings(html, office.url);
          for (const u of found) if (!candidates.has(u)) candidates.set(u, office.name || undefined);
        } catch (e) {
          ctx.log(`century21: office page failed ${office.url}: ${(e as Error).message}`);
        }
      }
      const added = candidates.size - before;
      ctx.log(`century21: ronda ${round}/${rounds} +${added} candidatas (total ${candidates.size})`);
      if (round > 1 && added === 0) break; // sampling saturated
    }

    // Suggest seeds (≤20 per query): pre-filter to rentals of the requested
    // type in the target cities; the detail parse re-checks everything.
    const suggestUrls = [
      `${SUGGEST}/casa_habitacional/renta/en-estado_valle-del-cauca`,
      `${SUGGEST}/casa_habitacional/renta/renta`,
    ];
    const typeNouns = new Set(types);
    for (const q of suggestUrls) {
      if (ctx.signal?.aborted) return;
      try {
        const data = await http.getJson<{ claves?: SuggestItem[] }>(q, { via: "auto", timeoutMs: 15000 });
        for (const item of data.claves ?? []) {
          const abs = item.url ? safeSiteUrl(item.url.split("?")[0]) : null;
          if (!abs || candidates.has(abs)) continue;
          if (norm(item.tipoOperacion ?? "") !== "renta") continue;
          if (item.subtipoPropiedad && !typeNouns.has(norm(item.subtipoPropiedad))) continue;
          if (item.municipio && !cities.includes(norm(item.municipio))) continue;
          candidates.set(abs, item.nombreOficina || undefined);
        }
      } catch {
        /* suggest is best-effort */
      }
    }

    ctx.log(
      `century21: ${candidates.size} candidatas (tipo=${params.propertyType}, ciudades=[${params.cities.join(", ")}])`,
    );

    let count = 0;
    for (const [url, agencyHint] of candidates) {
      if (ctx.signal?.aborted) return;
      if (count >= limit) break;
      const safe = safeSiteUrl(url);
      if (!safe) continue;

      let html: string;
      try {
        html = await http.getText(safe, { via: "auto", timeoutMs: 15000 });
      } catch (e) {
        ctx.log(`century21: detail failed ${safe}: ${(e as Error).message}`);
        continue;
      }
      try {
        const parsed = parseDetail(html, safe);
        if (!parsed) continue;
        if (parsed.op !== "renta") continue;
        if (!parsed.type || !types.includes(parsed.type)) continue;
        if (!parsed.listing.city || !cities.includes(norm(parsed.listing.city))) continue;
        // Renta mensual en COP: por encima de 50M/mes es un precio de venta.
        if (parsed.listing.price != null && parsed.listing.price > 50_000_000) continue;

        const listing = parsed.listing;
        listing.agency = agencyHint ?? null;
        if (listing.agency) listing.phone = offices.phones.get(norm(listing.agency)) ?? null;
        count++;
        yield listing;
      } catch (e) {
        ctx.log(`century21: parse failed ${safe}: ${(e as Error).message}`);
      }
    }
    ctx.log(`century21: yielded ${count}`);
  },

  async fetchDetail(url: string, ctx: AdapterContext): Promise<Partial<Listing> | null> {
    const safe = safeSiteUrl(url);
    if (!safe) return null;
    const http = new HttpClient();
    try {
      const html = await http.getText(safe, { via: "auto", timeoutMs: 15000 });
      return parseDetail(html, safe)?.listing ?? null;
    } catch (e) {
      ctx.log(`century21: fetchDetail failed ${safe}: ${(e as Error).message}`);
      return null;
    }
  },
};

export default century21Adapter;
