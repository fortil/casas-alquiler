import { describe, it, expect } from "vitest";
import { scoreListings, applyHardFilters, costPerM2 } from "@/lib/core/score";
import { DEFAULT_WEIGHTS } from "@/lib/config";
import { makeEvaluated } from "./helpers";

describe("scoreListings — degenerate inputs (no NaN)", () => {
  it("handles a single listing: finite score, rank 1", () => {
    const [r] = scoreListings([makeEvaluated({ price: 1000000, areaM2: 100, distanceKm: 5 })], DEFAULT_WEIGHTS);
    expect(Number.isFinite(r.score)).toBe(true);
    expect(r.score).toBeCloseTo(1, 5); // all factors neutral -> 1
    expect(r.rank).toBe(1);
  });

  it("handles identical listings without NaN and equal scores", () => {
    const items = [
      makeEvaluated({ price: 1000000, areaM2: 100, distanceKm: 5 }),
      makeEvaluated({ price: 1000000, areaM2: 100, distanceKm: 5 }),
    ];
    const ranked = scoreListings(items, DEFAULT_WEIGHTS);
    expect(ranked.every((r) => Number.isFinite(r.score))).toBe(true);
    expect(ranked[0].score).toBeCloseTo(ranked[1].score, 6);
  });

  it("returns [] for an empty set", () => {
    expect(scoreListings([], DEFAULT_WEIGHTS)).toEqual([]);
  });

  it("tolerates all-zero weights (falls back to wSum=1, finite scores)", () => {
    const items = [
      makeEvaluated({ price: 1000000, areaM2: 120, distanceKm: 2 }),
      makeEvaluated({ price: 3000000, areaM2: 80, distanceKm: 9 }),
    ];
    const ranked = scoreListings(items, { wCost: 0, wArea: 0, wDist: 0 });
    expect(ranked.every((r) => Number.isFinite(r.score))).toBe(true);
  });
});

describe("costPerM2 — admin handling", () => {
  it("treats missing admin as 0", () => {
    expect(costPerM2(makeEvaluated({ price: 1000000, admin: null, areaM2: 100 }))).toBe(10000);
  });
});

describe("applyHardFilters — combined constraints", () => {
  it("applies area, distance, price and bedrooms together", () => {
    const items = [
      makeEvaluated({ areaM2: 100, distanceKm: 3, price: 2000000, bedrooms: 3 }), // ok
      makeEvaluated({ areaM2: 70, distanceKm: 3, price: 2000000, bedrooms: 3 }), // area
      makeEvaluated({ areaM2: 100, distanceKm: 99, price: 2000000, bedrooms: 3 }), // dist
      makeEvaluated({ areaM2: 100, distanceKm: 3, price: 0, bedrooms: 3 }), // price
      makeEvaluated({ areaM2: 100, distanceKm: 3, price: 2000000, bedrooms: 1 }), // beds
    ];
    const { kept, dropped } = applyHardFilters(items, { minAreaM2: 80, maxDistKm: 10, minBedrooms: 2 });
    expect(kept).toHaveLength(1);
    expect(dropped).toHaveLength(4);
  });

  it("applies a price range (min/max), keeping only listings inside it", () => {
    const items = [
      makeEvaluated({ areaM2: 100, distanceKm: 3, price: 500000 }), // below min
      makeEvaluated({ areaM2: 100, distanceKm: 3, price: 1500000 }), // inside
      makeEvaluated({ areaM2: 100, distanceKm: 3, price: 4000000 }), // above max
    ];
    const { kept } = applyHardFilters(items, {
      minAreaM2: 80,
      maxDistKm: 10,
      minPrice: 1000000,
      maxPrice: 2000000,
    });
    expect(kept).toHaveLength(1);
    expect(kept[0].price).toBe(1500000);
  });

  it("treats price min/max of 0 as no bound", () => {
    const items = [
      makeEvaluated({ areaM2: 100, distanceKm: 3, price: 100000 }),
      makeEvaluated({ areaM2: 100, distanceKm: 3, price: 9000000 }),
    ];
    const { kept } = applyHardFilters(items, { minAreaM2: 80, maxDistKm: 10, minPrice: 0, maxPrice: 0 });
    expect(kept).toHaveLength(2);
  });

  it("keeps listings with unknown distance? no — they are dropped (no location)", () => {
    const { kept } = applyHardFilters(
      [makeEvaluated({ areaM2: 100, price: 1000000, distanceKm: null })],
      { minAreaM2: 80, maxDistKm: 10 },
    );
    expect(kept).toHaveLength(0);
  });
});
