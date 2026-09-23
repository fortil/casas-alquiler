import { describe, it, expect } from "vitest";
import { applyHardFilters, scoreListings, costPerM2 } from "@/lib/core/score";
import { DEFAULT_WEIGHTS } from "@/lib/config";
import { makeEvaluated } from "./helpers";

describe("applyHardFilters", () => {
  it("drops listings below min area, beyond max distance, or missing price", () => {
    const items = [
      makeEvaluated({ areaM2: 60, distanceKm: 2 }), // too small
      makeEvaluated({ areaM2: 120, distanceKm: 50 }), // too far
      makeEvaluated({ areaM2: 120, distanceKm: 2, price: null }), // no price
      makeEvaluated({ areaM2: 120, distanceKm: 2, price: 2000000 }), // ok
    ];
    const { kept, dropped } = applyHardFilters(items, { minAreaM2: 80, maxDistKm: 10 });
    expect(kept).toHaveLength(1);
    expect(dropped).toHaveLength(3);
  });

  it("drops listings with known bedrooms below the minimum, keeps unknown", () => {
    const items = [
      makeEvaluated({ areaM2: 100, distanceKm: 2, bedrooms: 2 }), // below min -> drop
      makeEvaluated({ areaM2: 100, distanceKm: 2, bedrooms: 3 }), // ok
      makeEvaluated({ areaM2: 100, distanceKm: 2, bedrooms: null }), // unknown -> keep
    ];
    const { kept } = applyHardFilters(items, { minAreaM2: 80, maxDistKm: 10, minBedrooms: 3 });
    expect(kept).toHaveLength(2);
    expect(kept.some((k) => k.bedrooms === 2)).toBe(false);
  });

  it("allows extra tolerance for imprecise (barrio_centroid) geocodes", () => {
    const item = makeEvaluated({
      areaM2: 100,
      distanceKm: 10.5,
      geocodePrecision: "barrio_centroid",
    });
    const { kept } = applyHardFilters([item], { minAreaM2: 80, maxDistKm: 10 });
    expect(kept).toHaveLength(1); // 10.5 <= 10 + 1.0 tolerance
  });
});

describe("costPerM2", () => {
  it("includes the admin fee in the monthly outlay", () => {
    const l = makeEvaluated({ price: 1000000, admin: 200000, areaM2: 100 });
    expect(costPerM2(l)).toBe(12000);
  });
});

describe("scoreListings", () => {
  it("ranks cheaper/m², larger and closer higher", () => {
    const best = makeEvaluated({ price: 1000000, admin: 0, areaM2: 120, distanceKm: 1 });
    const worst = makeEvaluated({ price: 3000000, admin: 0, areaM2: 80, distanceKm: 9 });
    const mid = makeEvaluated({ price: 2000000, admin: 0, areaM2: 100, distanceKm: 5 });
    const ranked = scoreListings([worst, mid, best], DEFAULT_WEIGHTS);
    expect(ranked[0].sourceListingId).toBe(best.sourceListingId);
    expect(ranked[2].sourceListingId).toBe(worst.sourceListingId);
    expect(ranked.map((r) => r.rank)).toEqual([1, 2, 3]);
  });

  it("neutralizes a factor with no spread", () => {
    const a = makeEvaluated({ price: 1000000, areaM2: 100, distanceKm: 3 });
    const b = makeEvaluated({ price: 2000000, areaM2: 100, distanceKm: 3 });
    const ranked = scoreListings([a, b], DEFAULT_WEIGHTS);
    // same area + distance => only cost separates them; cheaper wins
    expect(ranked[0].sourceListingId).toBe(a.sourceListingId);
  });
});
