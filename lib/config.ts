import type { GeoPoint } from "@/lib/core/schema";
import { norm } from "@/lib/util/text";

/** DANE municipality codes (used by some site APIs, e.g. bienco). */
export const CITY_DANE: Record<string, string> = {
  cali: "76001",
  jamundi: "76364",
  palmira: "76520",
  yumbo: "76892",
};

/** Department slug shared by most portals for the target cities. */
export const DEPARTMENT_SLUG = "valle-del-cauca";

/** Cities offered in the UI (search form + site-discovery panel). */
export const CITIES: { slug: string; label: string }[] = [
  { slug: "jamundi", label: "Jamundí" },
  { slug: "cali", label: "Cali" },
];

/** Default scoring weights (tenant value-for-money). Sum should be 1.0. */
export const DEFAULT_WEIGHTS = { wCost: 0.5, wArea: 0.3, wDist: 0.2 } as const;

/** Straight-line under-estimates road distance; widen the radius by this factor. */
export const URBAN_DETOUR_FACTOR = 1.35;

/** Extra km of slack added to the max-distance filter by geocode precision. */
export const PRECISION_TOLERANCE_KM: Record<string, number> = {
  rooftop: 0,
  source: 0.2,
  street: 0.3,
  barrio_centroid: 1.0,
  city: 4.0,
};

/**
 * "Southern Cali" barrios / comunas (normalized). Most portals filter by city,
 * not sub-zone, so the southern-Cali narrowing happens in our pipeline by
 * matching the listing barrio against this list. Editable via the config page.
 */
export const SOUTHERN_CALI_ZONES: string[] = [
  "ciudad jardin",
  "pance",
  "valle del lili",
  "el caney",
  "caney",
  "el limonar",
  "gran limonar",
  "el ingenio",
  "bochalema",
  "ciudad 2000",
  "la hacienda",
  "los portales",
  "capri",
  "mayapan",
  "las vegas",
  "el refugio",
  "alferez real",
  "la maria",
  "holguines",
  "comuna 17",
  "comuna 22",
  "sur",
];

/** True when a barrio belongs to the configured southern-Cali set. */
export function isSouthernCali(barrio?: string | null, zones: string[] = SOUTHERN_CALI_ZONES): boolean {
  const b = norm(barrio);
  if (!b) return false;
  return zones.some((z) => {
    const zn = norm(z);
    return b.includes(zn) || zn.includes(b);
  });
}

/** Parse "lat,lng" into a GeoPoint. */
export function parsePoint(s: string | null | undefined): GeoPoint | null {
  if (!s) return null;
  const m = s.split(",").map((x) => parseFloat(x.trim()));
  if (m.length === 2 && Number.isFinite(m[0]) && Number.isFinite(m[1])) {
    return { lat: m[0], lng: m[1] };
  }
  return null;
}

/** Default reference point from env (fallback: centro de Cali). */
export function defaultRefPoint(): GeoPoint {
  return parsePoint(process.env.DEFAULT_REF_POINT) ?? { lat: 3.4516, lng: -76.532 };
}

export function defaultCities(): string[] {
  return (process.env.DEFAULT_CITIES ?? "cali")
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);
}

export type DistanceMode = "haversine" | "google_driving";

/** A realistic desktop UA + Colombian locale, used for all polite scraping. */
export const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Accept-Language": "es-CO,es;q=0.9,en;q=0.8",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
};

/** Per-host polite delay between requests, in ms. */
export const REQUEST_DELAY_MS = 1100;
