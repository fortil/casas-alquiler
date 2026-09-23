import { prisma } from "@/lib/db/client";
import { googleGeocode, hasGoogleKey } from "@/lib/providers/googlemaps";
import { norm } from "@/lib/util/text";
import { isValidPoint, type GeocodePrecision, type Listing } from "@/lib/core/schema";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export interface GeoResult {
  lat: number;
  lng: number;
  precision: GeocodePrecision;
  provider: string;
}

/**
 * Geocode a free-text query, caching the result. Honors Google's 30-day cache
 * limit on lat/long (a google-sourced cache row older than 30 days is refreshed;
 * place_id is retained). Returns null when no provider/key is available.
 */
export async function geocodeQuery(query: string): Promise<GeoResult | null> {
  const q = norm(query);
  if (!q) return null;

  const cached = await prisma.geocodeCache.findUnique({ where: { query: q } });
  if (cached) {
    const stale =
      cached.provider === "google" &&
      Date.now() - cached.createdAt.getTime() > THIRTY_DAYS_MS;
    if (!stale) {
      return {
        lat: cached.lat,
        lng: cached.lng,
        precision: cached.precision as GeocodePrecision,
        provider: cached.provider,
      };
    }
  }

  if (!hasGoogleKey()) return cached ? toResult(cached) : null;

  const g = await googleGeocode(query);
  if (!g) return cached ? toResult(cached) : null;

  await prisma.geocodeCache.upsert({
    where: { query: q },
    create: {
      query: q,
      lat: g.lat,
      lng: g.lng,
      precision: g.precision,
      provider: "google",
      placeId: g.placeId,
    },
    update: {
      lat: g.lat,
      lng: g.lng,
      precision: g.precision,
      provider: "google",
      placeId: g.placeId,
      createdAt: new Date(),
    },
  });

  return { lat: g.lat, lng: g.lng, precision: g.precision, provider: "google" };
}

function toResult(row: {
  lat: number;
  lng: number;
  precision: string;
  provider: string;
}): GeoResult {
  return {
    lat: row.lat,
    lng: row.lng,
    precision: row.precision as GeocodePrecision,
    provider: row.provider,
  };
}

/** Build the most specific geocoding query available for a listing. */
export function geocodeQueryForListing(l: Pick<Listing, "address" | "conjunto" | "barrio" | "city">): {
  query: string;
  precision: GeocodePrecision;
} | null {
  const city = l.city ? `${l.city}, Valle del Cauca, Colombia` : "Colombia";
  if (l.address && norm(l.address).length > 4) {
    return { query: `${l.address}, ${city}`, precision: "street" };
  }
  if (l.conjunto && norm(l.conjunto).length > 2) {
    const barrio = l.barrio ? `, ${l.barrio}` : "";
    return { query: `${l.conjunto}${barrio}, ${city}`, precision: "barrio_centroid" };
  }
  if (l.barrio && norm(l.barrio).length > 2) {
    return { query: `${l.barrio}, ${city}`, precision: "barrio_centroid" };
  }
  if (l.city) return { query: city, precision: "city" };
  return null;
}

/**
 * Ensure a listing has coordinates. Prefers source-provided lat/lng; otherwise
 * geocodes the best available query. Mutates and returns the listing.
 */
export async function ensureListingGeo(l: Listing): Promise<Listing> {
  if (isValidPoint({ lat: l.lat ?? undefined, lng: l.lng ?? undefined })) {
    if (!l.geocodePrecision) l.geocodePrecision = "source";
    return l;
  }
  const built = geocodeQueryForListing(l);
  if (!built) return l;
  const g = await geocodeQuery(built.query);
  if (g) {
    l.lat = g.lat;
    l.lng = g.lng;
    // Use the coarser of (query precision, provider precision).
    l.geocodePrecision = coarser(built.precision, g.precision);
  }
  return l;
}

const PRECISION_RANK: Record<GeocodePrecision, number> = {
  rooftop: 0,
  source: 1,
  street: 2,
  barrio_centroid: 3,
  city: 4,
};

function coarser(a: GeocodePrecision, b: GeocodePrecision): GeocodePrecision {
  return PRECISION_RANK[a] >= PRECISION_RANK[b] ? a : b;
}
