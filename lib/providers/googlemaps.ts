import { Client, type LatLngLiteral } from "@googlemaps/google-maps-services-js";
import type { GeoPoint, GeocodePrecision } from "@/lib/core/schema";

const client = new Client({});

export function hasGoogleKey(): boolean {
  return !!process.env.GOOGLE_MAPS_API_KEY;
}

function key(): string {
  const k = process.env.GOOGLE_MAPS_API_KEY;
  if (!k) throw new Error("GOOGLE_MAPS_API_KEY is not set");
  return k;
}

/** Map Google's location_type to our precision scale. */
function precisionFromLocationType(lt?: string): GeocodePrecision {
  switch (lt) {
    case "ROOFTOP":
      return "rooftop";
    case "RANGE_INTERPOLATED":
      return "street";
    case "GEOMETRIC_CENTER":
      return "barrio_centroid";
    default:
      return "city"; // APPROXIMATE
  }
}

export interface GoogleGeocodeResult {
  lat: number;
  lng: number;
  precision: GeocodePrecision;
  placeId: string | null;
  formatted: string | null;
}

export async function googleGeocode(query: string): Promise<GoogleGeocodeResult | null> {
  if (!hasGoogleKey()) return null;
  try {
    const res = await client.geocode({
      params: {
        address: query,
        key: key(),
        region: "co",
        language: "es",
        components: { country: "CO" } as never,
      },
      timeout: 8000,
    });
    const r = res.data.results?.[0];
    if (!r) return null;
    return {
      lat: r.geometry.location.lat,
      lng: r.geometry.location.lng,
      precision: precisionFromLocationType(r.geometry.location_type as string),
      placeId: r.place_id ?? null,
      formatted: r.formatted_address ?? null,
    };
  } catch {
    return null;
  }
}

export interface DistanceResult {
  km: number;
  min: number;
}

/**
 * Driving distance/time from one origin to many destinations.
 * Chunks destinations to respect the 25-per-request limit and returns a
 * result aligned 1:1 with `destinations` (null where unavailable).
 */
export async function googleDistanceMatrix(
  origin: GeoPoint,
  destinations: GeoPoint[],
): Promise<(DistanceResult | null)[]> {
  if (!hasGoogleKey() || destinations.length === 0) {
    return destinations.map(() => null);
  }
  const out: (DistanceResult | null)[] = [];
  const CHUNK = 25;
  for (let i = 0; i < destinations.length; i += CHUNK) {
    const chunk = destinations.slice(i, i + CHUNK);
    try {
      const res = await client.distancematrix({
        params: {
          origins: [`${origin.lat},${origin.lng}` as unknown as LatLngLiteral],
          destinations: chunk.map(
            (d) => `${d.lat},${d.lng}` as unknown as LatLngLiteral,
          ),
          key: key(),
          language: "es",
          region: "co",
        },
        timeout: 10000,
      });
      const els = res.data.rows?.[0]?.elements ?? [];
      for (let j = 0; j < chunk.length; j++) {
        const el = els[j];
        if (el && el.status === "OK" && el.distance && el.duration) {
          out.push({ km: el.distance.value / 1000, min: el.duration.value / 60 });
        } else {
          out.push(null);
        }
      }
    } catch {
      for (let j = 0; j < chunk.length; j++) out.push(null);
    }
  }
  return out;
}
