import type { Listing, ResolvedCrawlParams } from "@/lib/core/schema";
import { norm, parseArea, parseIntSafe, parsePriceCOP, titleCase } from "@/lib/util/text";
import { HttpClient } from "@/lib/adapters/base/httpClient";
import type { AdapterContext, SourceAdapter } from "@/lib/adapters/types";

const BASE = "https://www.inmobiliariajr.com.co";
const API = "https://inmobiliariajr.com.co/wp-json/wasi-proxy/v1/properties";
const AGENCY = "Inmobiliaria JR";

/**
 * Single WASI-proxy object as returned by the WordPress endpoint.
 * Every value comes back as a string except id_property (number) — be defensive.
 */
interface JrItem {
  id_property?: number | string;
  id_property_type?: number | string;
  title?: string;
  for_rent?: string;
  rent_price?: string;
  rent_price_label?: string;
  maintenance_fee?: string;
  maintenance_fee_label?: string;
  city_label?: string;
  region_label?: string;
  zone_label?: string;
  location_label?: string;
  address?: string;
  latitude?: string;
  longitude?: string;
  area?: string;
  unit_area_label?: string;
  built_area?: string;
  private_area?: string;
  bedrooms?: string;
  bathrooms?: string;
  garages?: string;
  stratum?: string;
  observations?: string;
  main_image?: unknown;
  link?: string;
  user_data?: { first_name?: string; last_name?: string };
}

/**
 * The endpoint returns an OBJECT keyed by numeric index plus status/total:
 * { status:"success", total:N, "0":{...}, "1":{...}, ... }.
 */
interface JrResponse {
  status?: string;
  total?: number;
  [index: string]: unknown;
}

/** Pull only the numeric-indexed property objects out of the response object. */
function extractItems(resp: JrResponse): JrItem[] {
  const out: JrItem[] = [];
  for (const [key, value] of Object.entries(resp)) {
    if (!/^\d+$/.test(key)) continue; // skip "status" / "total"
    if (value && typeof value === "object") out.push(value as JrItem);
  }
  return out;
}

/**
 * The WASI id_property_type codes are not a reliable casa/apartamento signal on
 * this site (e.g. code 1 mixes apartamentos and casas, and no type label is
 * exposed). The free-text title is the dependable discriminator.
 */
function matchesPropertyType(it: JrItem, want: ResolvedCrawlParams["propertyType"]): boolean {
  const t = norm(it.title);
  const isCasa = /\bcasa\b/.test(t);
  // "apartamento" and "aparta estudio/apartaestudio" both count as apartment-like.
  const isApto = /\bapartamento\b|\baparta\s?estudio\b|\bapartaestudio\b/.test(t);
  // Clearly non-residential / non-house listings to keep out of either bucket.
  const isNonResidential =
    /\blocal\b|\bcomercial\b|\boficina\b|\bconsultorio\b|\bbodega\b|\blote\b|\bedificio\b|\bparqueadero\b/.test(t);
  if (want === "casa") {
    // Prefer an explicit "casa" match; never let a non-residential title through.
    return isCasa && !isNonResidential;
  }
  // want === "apartamento"
  if (isNonResidential && !isApto) return false;
  if (isApto) return true;
  // Fall back: not clearly a casa and not non-residential -> treat as apartamento
  // (avoids dropping rentals whose title omits the type word).
  return !isCasa;
}

/** Try to recover the conjunto/condominio name from the title, else null. */
function extractConjunto(it: JrItem): string | null {
  const raw = (it.title ?? "").replace(/\s+/g, " ").trim();
  if (!raw) return null;
  // Markers used on this site: "C.R", "CR", "CONJUNTO RESIDENCIAL", "CONDOMINIO",
  // "EDIFICIO", "ED." — the project name follows at the tail of the title.
  const m = raw.match(
    /(?:CONJUNTO\s+RESIDENCIAL|CONDOMINIO|EDIFICIO|ED\.?|C\.?\s?R\.?)\s+([A-Za-zÁÉÍÓÚÑáéíóúñ0-9][A-Za-zÁÉÍÓÚÑáéíóúñ0-9 .]+?)\s*$/,
  );
  if (!m) return null;
  const name = m[1].trim();
  if (!name || name.length < 2) return null;
  return titleCase(name);
}

/** Validate a 1..6 estrato, returning null for anything out of range. */
function parseEstrato(input: string | undefined): number | null {
  const n = parseIntSafe(input ?? null);
  if (n == null || n < 1 || n > 6) return null;
  return n;
}

function toFiniteNumber(input: string | undefined): number | null {
  if (input == null) return null;
  const n = parseFloat(input);
  return Number.isFinite(n) ? n : null;
}

function normalize(it: JrItem): Listing | null {
  const id = it.id_property;
  if (id == null || id === "") return null;
  const sourceListingId = String(id);

  const price =
    parsePriceCOP(it.rent_price) ?? parsePriceCOP(it.rent_price_label);
  const admin = parsePriceCOP(it.maintenance_fee_label);

  const lat = toFiniteNumber(it.latitude);
  const lng = toFiniteNumber(it.longitude);
  const hasCoords = lat != null && lng != null && (lat !== 0 || lng !== 0);

  // Prefer reported total area, then built, then private.
  const area =
    parseArea(it.area ?? null) ??
    parseArea(it.built_area ?? null) ??
    parseArea(it.private_area ?? null);

  const barrio = it.zone_label?.trim() ? titleCase(it.zone_label.trim()) : null;
  const city = it.city_label?.trim() || null;
  const address = it.address?.trim() || null;

  const garages = parseIntSafe(it.garages ?? null);

  return {
    source: "inmobiliariajr",
    sourceListingId,
    url: `${BASE}/propiedad/${sourceListingId}`,
    title: it.title?.replace(/\s+/g, " ").trim() || null,
    barrio,
    conjunto: extractConjunto(it),
    city,
    address,
    lat: hasCoords ? lat : null,
    lng: hasCoords ? lng : null,
    geocodePrecision: hasCoords ? "source" : null,
    areaM2: area,
    bedrooms: parseIntSafe(it.bedrooms ?? null),
    bathrooms: parseIntSafe(it.bathrooms ?? null),
    parking: garages != null && garages >= 0 ? garages : null,
    price,
    admin,
    estrato: parseEstrato(it.stratum),
    currency: "COP",
    agency: AGENCY,
    phone: null, // per-listing phone is not exposed by this endpoint
    hasWhatsapp: false,
    rawJson: JSON.stringify(it),
  };
}

export const inmobiliariajrAdapter: SourceAdapter = {
  id: "inmobiliariajr",
  label: "Inmobiliaria JR",
  tier: "A",
  domain: "inmobiliariajr.com.co",

  async *fetchList(params: ResolvedCrawlParams, ctx: AdapterContext) {
    if (ctx.signal?.aborted) return;

    const http = new HttpClient();
    const wantCities = new Set(params.cities.map((c) => norm(c)));

    // Server-side query params are ignored, so fetch the full (small) set once.
    let resp: JrResponse;
    try {
      resp = await http.getJson<JrResponse>(API);
    } catch (e) {
      ctx.log(`inmobiliariajr: list fetch failed: ${(e as Error).message}`);
      return;
    }

    const items = extractItems(resp);
    ctx.log(`inmobiliariajr: ${items.length} properties total (status=${resp.status ?? "?"})`);

    let yielded = 0;
    for (const it of items) {
      if (ctx.signal?.aborted) return;

      // Keep rentals only.
      if (String(it.for_rent) !== "true") continue;

      // Keep only requested cities (match normalized city_label).
      const cityNorm = norm(it.city_label);
      const cityHit = [...wantCities].some(
        (w) => cityNorm === w || cityNorm.includes(w) || w.includes(cityNorm),
      );
      if (!cityHit) continue;

      // Keep only the requested property type (casa vs apartamento).
      if (!matchesPropertyType(it, params.propertyType)) continue;

      const listing = normalize(it);
      if (listing) {
        yielded++;
        yield listing;
      }
    }

    ctx.log(`inmobiliariajr: yielded ${yielded} ${params.propertyType} rentals for [${params.cities.join(", ")}]`);
  },
};

export default inmobiliariajrAdapter;
