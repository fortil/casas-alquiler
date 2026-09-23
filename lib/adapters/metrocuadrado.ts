// Metrocuadrado adapter — Tier C.
//
// NEEDS LIVE VALIDATION WITH A COLOMBIAN IP / BRIGHT DATA.
//   - The site sits behind Imperva Incapsula and geo-gates results: page 1 may
//     answer from a non-CO IP, but page 2+ reliably requires a Colombian exit
//     node. We therefore route every request through Bright Data (Web Unlocker
//     country=co), which clears Incapsula and gives us the es-CO variant.
//   - It is a Next.js *App Router* SPA: the hydrated listing array is NOT in a
//     classic <script id="__NEXT_DATA__"> blob (extractNextData returns null
//     here). Instead the React Server Component payload is streamed via
//     self.__next_f.push([1,"...escaped json..."]) chunks. We reassemble those
//     chunks and bracket-match every object that carries a "midinmueble" key
//     (the per-listing id). Confirmed live for /casas/arriendo/cali/ (56 on
//     page 1) and /casas/arriendo/jamundi/ (54 on page 1, totalEntries 153).
//   - The parsing is defensive (optional chaining + try/catch per chunk/object)
//     so it degrades to "0 listings" instead of crashing if the payload shape
//     changes. JSON-LD on the list page is only a BreadcrumbList, so there is
//     no useful JSON-LD/og fallback for the listings themselves.
//   - /detail/ is Disallowed by robots.txt, so we never fetch it. Happily the
//     contact phone + whatsapp ARE present directly in the list payload, so we
//     can populate them without touching a disallowed path.
//   - GRACEFUL DEGRADE: if Bright Data is not configured we log and return
//     without yielding (a direct fetch would be blocked / geo-gated anyway).

import { CITY_DANE, DEPARTMENT_SLUG } from "@/lib/config";
import type { Listing, ResolvedCrawlParams } from "@/lib/core/schema";
import type { AdapterContext, SourceAdapter } from "@/lib/adapters/types";
import { HttpClient } from "@/lib/adapters/base/httpClient";
import { absolutize } from "@/lib/adapters/base/parse";
import {
  parseArea,
  parseIntSafe,
  parsePriceCOP,
  titleCase,
} from "@/lib/util/text";
import { hasBrightData } from "@/lib/providers/brightdata";

const BASE = "https://www.metrocuadrado.com";

/** Reference CITY_DANE / DEPARTMENT_SLUG so they are not flagged as unused and
 *  are available if the site later switches to a DANE/dept URL form. */
void CITY_DANE;
void DEPARTMENT_SLUG;

/** A single listing as it appears in the __next_f RSC payload. */
interface McItem {
  midinmueble?: string;
  title?: string;
  link?: string;
  contactPhone?: string | null;
  whatsapp?: string | null;
  haswhatsappbot?: string | null;
  mtipoinmueble?: { id?: string; nombre?: string } | null;
  mtiponegocio?: string | null;
  mvalorventa?: number | null;
  mvalorarriendo?: number | null;
  marea?: number | string | null; // total area (m2)
  mareac?: number | string | null; // area construida (m2)
  areaprivada?: number | string | null;
  areaPrivada?: number | string | null;
  mnrocuartos?: string | number | null;
  mnrobanos?: string | number | null;
  mnrogarajes?: string | number | null;
  mciudad?: { id?: string; nombre?: string } | null;
  mzona?: { id?: string; nombre?: string } | null;
  mbarrio?: string | null;
  mnombrecomunbarrio?: string | null;
  mnombreproyecto?: string | null;
  midempresa?: string | null;
  moferente?: string | null;
  estrato?: number | string | null;
  localizacion?: { lat?: number; lon?: number } | null;
  data?: {
    mvaloradministracion?: string | number | null;
    murldetalle?: string | null;
    mnombrevisitor?: string | null;
  } | null;
}

/** propertyType -> Metrocuadrado URL slug. */
function typeSlug(t: ResolvedCrawlParams["propertyType"]): string {
  return t === "apartamento" ? "apartamentos" : "casas";
}

function listUrl(typeSlugStr: string, city: string, page: number): string {
  const base = `${BASE}/${typeSlugStr}/arriendo/${encodeURIComponent(city)}/`;
  return page > 1 ? `${base}?page=${page}` : base;
}

/**
 * Reassemble the React Server Component stream that Next.js App Router emits via
 * self.__next_f.push([1,"...js-string..."]). Each captured group is a JS string
 * literal; JSON.parse decodes the escapes. Returns the concatenated payload.
 */
function decodeNextFlight(html: string): string {
  const out: string[] = [];
  const re = /self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    try {
      out.push(JSON.parse(m[1]) as string);
    } catch {
      /* skip malformed chunk */
    }
  }
  return out.join("");
}

/** Bracket-match the JSON object that encloses position `idx` inside `s`. */
function objectAround(s: string, idx: number): McItem | null {
  let start = -1;
  for (let i = idx; i >= 0; i--) {
    if (s[i] === "{") {
      start = i;
      break;
    }
  }
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(s.slice(start, i + 1)) as McItem;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/** Extract every listing object (keyed by "midinmueble") from the RSC payload. */
function extractItems(html: string): McItem[] {
  const flight = decodeNextFlight(html);
  if (!flight) return [];
  const items: McItem[] = [];
  const seen = new Set<string>();
  const re = /"midinmueble"\s*:\s*"([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(flight)) !== null) {
    const id = m[1];
    if (seen.has(id)) continue;
    const obj = objectAround(flight, m.index);
    if (obj?.midinmueble === id) {
      seen.add(id);
      items.push(obj);
    }
  }
  return items;
}

function asPositiveNum(v: number | string | null | undefined): number | null {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) && v > 0 ? v : null;
  return parseArea(v);
}

function isWhatsapp(it: McItem): boolean {
  const wa = it.whatsapp != null && String(it.whatsapp).trim() !== "";
  const bot = typeof it.haswhatsappbot === "string" && it.haswhatsappbot.toUpperCase() === "S";
  return wa || bot;
}

function normalize(it: McItem): Listing | null {
  const id = it.midinmueble;
  if (!id) return null;

  const href = it.data?.murldetalle ?? it.link ?? null;
  const url = absolutize(BASE, href) ?? `${BASE}/inmueble/${encodeURIComponent(id)}`;

  const price =
    it.mvalorarriendo && it.mvalorarriendo > 0
      ? it.mvalorarriendo
      : parsePriceCOP(it.mvalorventa ?? null);

  // Prefer total area, fall back to construida / privada.
  const area =
    asPositiveNum(it.marea) ??
    asPositiveNum(it.mareac) ??
    asPositiveNum(it.areaprivada ?? it.areaPrivada);

  const admin = parsePriceCOP(it.data?.mvaloradministracion ?? null);

  const lat = typeof it.localizacion?.lat === "number" ? it.localizacion.lat : null;
  const lng = typeof it.localizacion?.lon === "number" ? it.localizacion.lon : null;
  const hasCoords = Number.isFinite(lat as number) && Number.isFinite(lng as number);

  const estratoNum = parseIntSafe(it.estrato ?? null);
  const estrato = estratoNum != null && estratoNum >= 1 && estratoNum <= 6 ? estratoNum : null;

  // The list payload exposes phone directly (no /detail/ fetch, which robots
  // disallows). Prefer the plain contact phone over the wa-prefixed number.
  const rawPhone = it.contactPhone ?? it.whatsapp ?? null;
  const phone = rawPhone ? String(rawPhone).replace(/^57(?=\d{10}$)/, "") : null;

  const barrio = it.mbarrio || it.mnombrecomunbarrio || null;

  return {
    source: "metrocuadrado",
    sourceListingId: String(id),
    url,
    title: it.title?.trim() || null,
    barrio: barrio ? titleCase(barrio) : null,
    conjunto: it.mnombreproyecto ? titleCase(it.mnombreproyecto) : null,
    city: it.mciudad?.nombre?.trim() || null,
    address: null, // not provided on the list payload
    lat: hasCoords ? (lat as number) : null,
    lng: hasCoords ? (lng as number) : null,
    geocodePrecision: hasCoords ? "source" : null,
    areaM2: area,
    bedrooms: parseIntSafe(it.mnrocuartos ?? null),
    bathrooms: parseIntSafe(it.mnrobanos ?? null),
    parking: parseIntSafe(it.mnrogarajes ?? null),
    price,
    admin,
    estrato,
    currency: "COP",
    agency: it.moferente?.trim() || null,
    phone: phone && phone.length >= 7 ? phone : null,
    hasWhatsapp: isWhatsapp(it),
    rawJson: JSON.stringify(it),
  };
}

export const metrocuadradoAdapter: SourceAdapter = {
  id: "metrocuadrado",
  label: "Metrocuadrado",
  tier: "C",
  domain: "metrocuadrado.com",
  requiresBrightData: true,

  async *fetchList(params: ResolvedCrawlParams, ctx: AdapterContext) {
    if (!hasBrightData()) {
      ctx.log(
        "metrocuadrado: Bright Data not configured (BRIGHTDATA_API_KEY / " +
          "BRIGHTDATA_UNLOCKER_ZONE). Site is Incapsula + CO geo-gated; skipping.",
      );
      return;
    }

    const http = new HttpClient();
    const slug = typeSlug(params.propertyType);

    for (const city of params.cities) {
      let page = 1;
      while (page <= params.maxPagesPerSource) {
        if (ctx.signal?.aborted) return;

        const url = listUrl(slug, city, page);
        let html: string;
        try {
          html = await http.getText(url, {
            via: "brightdata",
            headers: { "Accept-Language": "es-CO,es;q=0.9,en;q=0.8" },
          });
        } catch (e) {
          ctx.log(`metrocuadrado: ${city} page ${page} fetch failed: ${(e as Error).message}`);
          break;
        }

        let items: McItem[];
        try {
          items = extractItems(html);
        } catch (e) {
          ctx.log(`metrocuadrado: ${city} page ${page} parse failed: ${(e as Error).message}`);
          break;
        }

        if (items.length === 0) {
          ctx.log(`metrocuadrado: ${city} page ${page} returned 0 listings — stopping`);
          break;
        }

        let yielded = 0;
        for (const it of items) {
          // Defensive: only keep arriendo + the requested property type.
          if (it.mtiponegocio && it.mtiponegocio.toLowerCase() !== "arriendo") continue;
          const l = normalize(it);
          if (l) {
            yielded++;
            yield l;
          }
        }

        ctx.log(`metrocuadrado: ${city} page ${page} (${yielded}/${items.length})`);
        page++;
      }
    }
  },
};

export default metrocuadradoAdapter;
