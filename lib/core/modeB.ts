import Papa from "papaparse";
import type { DistanceMode } from "@/lib/config";
import { type GeoPoint, type Listing } from "@/lib/core/schema";
import { rankListings, type RankResult } from "@/lib/core/pipeline";
import type { ScoreWeights } from "@/lib/core/score";
import { norm, parseArea, parsePriceCOP } from "@/lib/util/text";

/** Map of normalized header aliases -> canonical column. */
const HEADER_ALIASES: Record<string, string> = {
  barrio: "barrio",
  neighborhood: "barrio",
  sector: "barrio",
  conjunto: "conjunto",
  "conjunto residencial": "conjunto",
  complejo: "conjunto",
  urbanizacion: "conjunto",
  edificio: "conjunto",
  area: "area",
  "area m2": "area",
  "area (m2)": "area",
  "area construida": "area",
  metros: "area",
  m2: "area",
  mt2: "area",
  precio: "precio",
  price: "precio",
  valor: "precio",
  canon: "precio",
  arriendo: "precio",
  admin: "admin",
  administracion: "admin",
  "cuota administracion": "admin",
  link: "link",
  url: "link",
  enlace: "link",
  ciudad: "city",
  city: "city",
};

function canonicalKey(header: string): string | null {
  return HEADER_ALIASES[norm(header)] ?? null;
}

function isValidUrl(s: string | undefined): boolean {
  if (!s) return false;
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Parse a user-provided list (CSV text or pasted tab/comma table) with headers
 * {Barrio, Conjunto, Area, Precio, Link [, Admin, Ciudad]} into Listings.
 */
export function parseListInput(text: string): { listings: Listing[]; warnings: string[] } {
  const warnings: string[] = [];
  const parsed = Papa.parse<Record<string, string>>(text.trim(), {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });

  if (parsed.errors.length) {
    for (const e of parsed.errors.slice(0, 3)) warnings.push(`CSV: ${e.message} (row ${e.row})`);
  }

  const listings: Listing[] = [];
  parsed.data.forEach((row, i) => {
    const rec: Record<string, string> = {};
    for (const [k, v] of Object.entries(row)) {
      const ck = canonicalKey(k);
      if (ck) rec[ck] = (v ?? "").trim();
    }
    const link = rec.link;
    const price = parsePriceCOP(rec.precio);
    const area = parseArea(rec.area);
    if (!area && !price) {
      // empty/garbage row
      return;
    }
    listings.push({
      source: "manual",
      sourceListingId: link && isValidUrl(link) ? link : `row-${i + 1}`,
      url: link && isValidUrl(link) ? link : `https://manual.local/row-${i + 1}`,
      title: null,
      barrio: rec.barrio || null,
      conjunto: rec.conjunto || null,
      city: rec.city || null,
      address: null,
      lat: null,
      lng: null,
      geocodePrecision: null,
      areaM2: area,
      bedrooms: null,
      bathrooms: null,
      parking: null,
      price,
      admin: parsePriceCOP(rec.admin),
      estrato: null,
      currency: "COP",
      agency: null,
      phone: null,
      hasWhatsapp: false,
      rawJson: JSON.stringify(row),
    });
  });

  if (listings.length === 0) {
    warnings.push("No se reconocieron filas. Verifica que existan encabezados Barrio, Conjunto, Area, Precio, Link.");
  }
  return { listings, warnings };
}

export interface ModeBOptions {
  refPoint: GeoPoint;
  maxDistKm: number;
  minAreaM2: number;
  minBedrooms?: number;
  minPrice?: number;
  maxPrice?: number;
  weights: ScoreWeights;
  distanceMode: DistanceMode;
  topN?: number;
}

/** Score a user-provided list (no scraping; geocode barrio/conjunto centroids). */
export async function rankProvided(
  listings: Listing[],
  opts: ModeBOptions,
): Promise<RankResult> {
  return rankListings(listings, {
    refPoint: opts.refPoint,
    maxDistKm: opts.maxDistKm,
    minAreaM2: opts.minAreaM2,
    minBedrooms: opts.minBedrooms,
    minPrice: opts.minPrice,
    maxPrice: opts.maxPrice,
    weights: opts.weights,
    distanceMode: opts.distanceMode,
    topN: opts.topN,
    geocodeMissing: true,
  });
}
