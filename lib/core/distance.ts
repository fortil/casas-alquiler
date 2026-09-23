import { PRECISION_TOLERANCE_KM } from "@/lib/config";
import type { GeoPoint, GeocodePrecision } from "@/lib/core/schema";

const EARTH_RADIUS_KM = 6371;

/** Great-circle distance between two points, in kilometers. */
export function haversineKm(a: GeoPoint, b: GeoPoint): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Extra distance slack to allow for an imprecise geocode (barrio centroid etc.). */
export function precisionToleranceKm(precision?: GeocodePrecision | null): number {
  if (!precision) return PRECISION_TOLERANCE_KM.city;
  return PRECISION_TOLERANCE_KM[precision] ?? PRECISION_TOLERANCE_KM.city;
}
