import { describe, it, expect } from "vitest";
import { sortListings, cycleSort, type SortKey } from "@/lib/util/tableSort";
import { scoreListings } from "@/lib/core/score";
import { DEFAULT_WEIGHTS } from "@/lib/config";
import { makeEvaluated } from "./helpers";
import type { ScoredListing } from "@/lib/core/schema";

function rankedSet(): ScoredListing[] {
  return scoreListings(
    [
      makeEvaluated({ price: 2000000, areaM2: 100, distanceKm: 5, city: "Cali" }),
      makeEvaluated({ price: 1000000, areaM2: 100, distanceKm: 8, city: "Jamundí" }),
      makeEvaluated({ price: 1000000, areaM2: 100, distanceKm: 3, city: "Cali" }),
    ],
    DEFAULT_WEIGHTS,
  );
}

describe("cycleSort", () => {
  it("adds asc, toggles to desc, then removes on the third click", () => {
    let s: SortKey[] = [];
    s = cycleSort(s, "price");
    expect(s).toEqual([{ key: "price", dir: "asc" }]);
    s = cycleSort(s, "price");
    expect(s).toEqual([{ key: "price", dir: "desc" }]);
    s = cycleSort(s, "price");
    expect(s).toEqual([]);
  });

  it("appends new keys cumulatively (price, then distance)", () => {
    let s: SortKey[] = [];
    s = cycleSort(s, "price");
    s = cycleSort(s, "dist");
    expect(s).toEqual([
      { key: "price", dir: "asc" },
      { key: "dist", dir: "asc" },
    ]);
  });
});

describe("sortListings", () => {
  it("returns the input unchanged when no keys are set", () => {
    const rows = rankedSet();
    expect(sortListings(rows, [])).toBe(rows);
  });

  it("sorts by price asc, breaking ties by distance asc (cumulative)", () => {
    const rows = rankedSet();
    const sorted = sortListings(rows, [
      { key: "price", dir: "asc" },
      { key: "dist", dir: "asc" },
    ]);
    expect(sorted.map((r) => [r.price, r.distanceKm])).toEqual([
      [1000000, 3], // cheapest, then nearest of the two ties
      [1000000, 8],
      [2000000, 5],
    ]);
  });

  it("respects descending direction", () => {
    const rows = rankedSet();
    const sorted = sortListings(rows, [{ key: "price", dir: "desc" }]);
    expect(sorted[0].price).toBe(2000000);
  });

  it("keeps null values last regardless of direction", () => {
    const rows = scoreListings(
      [
        makeEvaluated({ price: 1000000, areaM2: 100, distanceKm: 5, estrato: 4 }),
        makeEvaluated({ price: 1500000, areaM2: 100, distanceKm: 5, estrato: null }),
        makeEvaluated({ price: 2000000, areaM2: 100, distanceKm: 5, estrato: 6 }),
      ],
      DEFAULT_WEIGHTS,
    );
    const asc = sortListings(rows, [{ key: "estrato", dir: "asc" }]);
    expect(asc[asc.length - 1].estrato).toBeNull();
    const desc = sortListings(rows, [{ key: "estrato", dir: "desc" }]);
    expect(desc[desc.length - 1].estrato).toBeNull();
  });
});
