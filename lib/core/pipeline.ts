import pLimit from "p-limit";
import type { DistanceMode } from "@/lib/config";
import { isSouthernCali, SOUTHERN_CALI_ZONES } from "@/lib/config";
import {
  type EvaluatedListing,
  type GeoPoint,
  type Listing,
  type ScoredListing,
  isValidPoint,
} from "@/lib/core/schema";
import { ensureListingGeo } from "@/lib/core/geocode";
import { haversineKm, precisionToleranceKm } from "@/lib/core/distance";
import { applyHardFilters, scoreListings, type ScoreWeights } from "@/lib/core/score";
import { googleDistanceMatrix, hasGoogleKey } from "@/lib/providers/googlemaps";
import { norm } from "@/lib/util/text";

export interface RankOptions {
  refPoint: GeoPoint;
  maxDistKm: number;
  minAreaM2: number;
  minBedrooms?: number;
  minPrice?: number;
  maxPrice?: number;
  weights: ScoreWeights;
  distanceMode: DistanceMode;
  southernCaliOnly?: boolean;
  southernZones?: string[];
  topN?: number;
  /** Geocode listings missing coordinates (default true). */
  geocodeMissing?: boolean;
}

export interface RankResult {
  ranked: ScoredListing[];
  top: ScoredListing[];
  stats: {
    input: number;
    withLocation: number;
    afterZoneFilter: number;
    kept: number;
    dropped: number;
    drivingComputed: number;
  };
  droppedReasons: Record<string, number>;
}

/**
 * The shared ranking pipeline for both modes:
 *   geocode → southern-Cali narrowing → haversine filter → optional Google
 *   driving refinement → tenant value-for-money scoring → Top N.
 */
export async function rankListings(
  listings: Listing[],
  opts: RankOptions,
): Promise<RankResult> {
  const droppedReasons: Record<string, number> = {};
  const bump = (r: string) => (droppedReasons[r] = (droppedReasons[r] ?? 0) + 1);

  // 1) Geocode anything missing coordinates (bounded concurrency).
  let working = listings;
  if (opts.geocodeMissing !== false) {
    const limit = pLimit(5);
    working = await Promise.all(
      listings.map((l) => limit(() => ensureListingGeo({ ...l }))),
    );
  } else {
    working = listings.map((l) => ({ ...l }));
  }
  const withLocation = working.filter((l) =>
    isValidPoint({ lat: l.lat ?? undefined, lng: l.lng ?? undefined }),
  ).length;

  // 2) Southern-Cali narrowing (Cali only; Jamundí and others pass through).
  const zones = opts.southernZones ?? SOUTHERN_CALI_ZONES;
  if (opts.southernCaliOnly) {
    const before = working.length;
    working = working.filter((l) => {
      if (norm(l.city) === "cali" && !isSouthernCali(l.barrio, zones)) {
        bump("outside southern Cali");
        return false;
      }
      return true;
    });
    void before;
  }
  const afterZoneFilter = working.length;

  // 3) Haversine distance for every listing.
  const evaluated: EvaluatedListing[] = working.map((l) => ({
    ...l,
    distanceKm: isValidPoint({ lat: l.lat ?? undefined, lng: l.lng ?? undefined })
      ? haversineKm(opts.refPoint, { lat: l.lat!, lng: l.lng! })
      : null,
  }));

  // 4) First hard filter on haversine (road distance >= straight-line, so any
  //    listing beyond maxDist straight-line is also beyond it by road).
  const pass1 = applyHardFilters(evaluated, {
    minAreaM2: opts.minAreaM2,
    maxDistKm: opts.maxDistKm,
    minBedrooms: opts.minBedrooms,
    minPrice: opts.minPrice,
    maxPrice: opts.maxPrice,
  });
  for (const d of pass1.dropped) bump(d.reason.replace(/[\d.]+/g, "#"));

  // 5) Optional Google driving refinement on the survivors.
  let kept = pass1.kept;
  let drivingComputed = 0;
  if (opts.distanceMode === "google_driving" && hasGoogleKey() && kept.length > 0) {
    const dests = kept.map((l) => ({ lat: l.lat!, lng: l.lng! }));
    const matrix = await googleDistanceMatrix(opts.refPoint, dests);
    const refined: EvaluatedListing[] = [];
    kept.forEach((l, i) => {
      const d = matrix[i];
      if (d) {
        drivingComputed++;
        l.drivingKm = d.km;
        l.drivingMin = d.min;
        l.distanceKm = d.km; // score against the real road distance
      }
      refined.push(l);
    });
    // Re-apply only the distance bound using the (now driving) distanceKm.
    kept = refined.filter((l) => {
      const tol = precisionToleranceKm(l.geocodePrecision);
      if (l.distanceKm != null && l.distanceKm > opts.maxDistKm + tol) {
        bump("driving distance > max");
        return false;
      }
      return true;
    });
  }

  // 6) Score + rank.
  const ranked = scoreListings(kept, opts.weights);
  const topN = opts.topN ?? 10;

  return {
    ranked,
    top: ranked.slice(0, topN),
    stats: {
      input: listings.length,
      withLocation,
      afterZoneFilter,
      kept: ranked.length,
      dropped: listings.length - ranked.length,
      drivingComputed,
    },
    droppedReasons,
  };
}
