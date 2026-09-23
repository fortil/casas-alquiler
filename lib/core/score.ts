import type { EvaluatedListing, ScoredListing } from "@/lib/core/schema";
import { precisionToleranceKm } from "@/lib/core/distance";

export interface ScoreWeights {
  wCost: number;
  wArea: number;
  wDist: number;
}

export interface HardFilters {
  minAreaM2: number;
  maxDistKm: number;
  /** minimum bedrooms; listings with a KNOWN lower count are dropped (unknown kept) */
  minBedrooms?: number;
  /** minimum monthly price (COP); 0 = no minimum */
  minPrice?: number;
  /** maximum monthly price (COP); 0 = no maximum */
  maxPrice?: number;
}

export interface FilterResult {
  kept: EvaluatedListing[];
  dropped: { listing: EvaluatedListing; reason: string }[];
}

/**
 * Apply the hard constraints that must never be traded away by scoring:
 *   distance <= max_dist (+ precision tolerance)  AND  area >= min_area
 * Also requires price + area to be present (needed to compute cost/m²).
 */
export function applyHardFilters(
  items: EvaluatedListing[],
  { minAreaM2, maxDistKm, minBedrooms = 0, minPrice = 0, maxPrice = 0 }: HardFilters,
): FilterResult {
  const kept: EvaluatedListing[] = [];
  const dropped: { listing: EvaluatedListing; reason: string }[] = [];

  for (const it of items) {
    if (it.areaM2 == null) {
      dropped.push({ listing: it, reason: "missing area" });
      continue;
    }
    if (it.areaM2 < minAreaM2) {
      dropped.push({ listing: it, reason: `area ${it.areaM2} < min ${minAreaM2}` });
      continue;
    }
    if (minBedrooms > 0 && it.bedrooms != null && it.bedrooms < minBedrooms) {
      dropped.push({ listing: it, reason: `bedrooms ${it.bedrooms} < min ${minBedrooms}` });
      continue;
    }
    if (it.price == null || it.price <= 0) {
      dropped.push({ listing: it, reason: "missing price" });
      continue;
    }
    if (minPrice > 0 && it.price < minPrice) {
      dropped.push({ listing: it, reason: `price ${it.price} < min ${minPrice}` });
      continue;
    }
    if (maxPrice > 0 && it.price > maxPrice) {
      dropped.push({ listing: it, reason: `price ${it.price} > max ${maxPrice}` });
      continue;
    }
    if (it.distanceKm == null) {
      dropped.push({ listing: it, reason: "no location / distance" });
      continue;
    }
    const tolerance = precisionToleranceKm(it.geocodePrecision);
    if (it.distanceKm > maxDistKm + tolerance) {
      dropped.push({
        listing: it,
        reason: `distance ${it.distanceKm.toFixed(1)}km > max ${maxDistKm}km`,
      });
      continue;
    }
    kept.push(it);
  }
  return { kept, dropped };
}

/** Full monthly outlay per m² (lower is better). Caller guarantees price+area. */
export function costPerM2(l: EvaluatedListing): number {
  return (l.price! + (l.admin ?? 0)) / l.areaM2!;
}

/**
 * Score + rank the surviving listings by tenant value-for-money.
 * Each factor is min-max normalized over the surviving set so weights are
 * comparable. When a factor has no spread, it is neutralized (norm = 1).
 */
export function scoreListings(
  items: EvaluatedListing[],
  weights: ScoreWeights,
): ScoredListing[] {
  if (items.length === 0) return [];

  const enriched = items.map((l) => ({ l, cpm2: costPerM2(l), dist: l.distanceKm! }));

  const cpm2s = enriched.map((e) => e.cpm2);
  const areas = enriched.map((e) => e.l.areaM2!);
  const dists = enriched.map((e) => e.dist);

  const [cMin, cMax] = minMax(cpm2s);
  const [aMin, aMax] = minMax(areas);
  const [dMin, dMax] = minMax(dists);

  const wSum = weights.wCost + weights.wArea + weights.wDist || 1;

  const scored: ScoredListing[] = enriched.map(({ l, cpm2, dist }) => {
    const normCost = invNorm(cpm2, cMin, cMax); // cheaper/m² => higher
    const normArea = norm(l.areaM2!, aMin, aMax); // larger => higher
    const normDist = invNorm(dist, dMin, dMax); // closer => higher
    const score =
      (weights.wCost * normCost + weights.wArea * normArea + weights.wDist * normDist) /
      wSum;
    return { ...l, costPerM2: cpm2, score, rank: 0 };
  });

  scored.sort((a, b) => b.score - a.score);
  scored.forEach((s, i) => (s.rank = i + 1));
  return scored;
}

function minMax(xs: number[]): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const x of xs) {
    if (x < lo) lo = x;
    if (x > hi) hi = x;
  }
  return [lo, hi];
}

/** Higher value => closer to 1. No spread => neutral 1. */
function norm(x: number, lo: number, hi: number): number {
  if (hi <= lo) return 1;
  return (x - lo) / (hi - lo);
}

/** Lower value => closer to 1. No spread => neutral 1. */
function invNorm(x: number, lo: number, hi: number): number {
  if (hi <= lo) return 1;
  return (hi - x) / (hi - lo);
}
