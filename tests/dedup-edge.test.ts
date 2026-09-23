import { describe, it, expect } from "vitest";
import { dedupeListings } from "@/lib/core/dedup";
import { makeListing } from "./helpers";

describe("dedupeListings — sourceLinks", () => {
  it("collects one {source,url} per portal for a 3-way merge, canonical first", () => {
    const base = { lat: 3.275, lng: -76.535, price: 1300000, areaM2: 86, bedrooms: 2 };
    const a = makeListing({ ...base, source: "fincaraiz", url: "https://fincaraiz/a", phone: null });
    const b = makeListing({ ...base, source: "ciencuadras", url: "https://ciencuadras/b", phone: "3160001122" });
    const c = makeListing({ ...base, source: "mitula", url: "https://mitula/c", phone: null });
    const [m] = dedupeListings([a, b, c]);
    expect(m.sourceLinks).toHaveLength(3);
    // phone-bearing (ciencuadras) is canonical -> listed first
    expect(m.sourceLinks[0].source).toBe("ciencuadras");
    expect(new Set(m.sourceLinks.map((s) => s.source))).toEqual(
      new Set(["fincaraiz", "ciencuadras", "mitula"]),
    );
    expect(m.mergedSources.sort()).toEqual(["ciencuadras", "fincaraiz", "mitula"]);
  });

  it("dedups identical URLs in sourceLinks", () => {
    const base = { lat: 3.275, lng: -76.535, price: 1300000, areaM2: 86, bedrooms: 2, url: "https://x/same" };
    const a = makeListing({ ...base, source: "s", sourceListingId: "1" });
    const b = makeListing({ ...base, source: "s", sourceListingId: "2" });
    const [m] = dedupeListings([a, b]);
    expect(m.sourceLinks).toHaveLength(1);
  });
});

describe("dedupeListings — avoiding false merges", () => {
  it("does NOT merge two location-less listings even with same price & area", () => {
    const a = makeListing({ lat: null, lng: null, barrio: null, conjunto: null, price: 2000000, areaM2: 100 });
    const b = makeListing({ source: "other", lat: null, lng: null, barrio: null, conjunto: null, price: 2000000, areaM2: 100 });
    expect(dedupeListings([a, b])).toHaveLength(2);
  });

  it("merges on a barrio anchor when geo is missing", () => {
    const a = makeListing({ lat: null, lng: null, barrio: "Pance", price: 2000000, areaM2: 100 });
    const b = makeListing({ source: "other", lat: null, lng: null, barrio: "Pance", price: 2010000, areaM2: 100 });
    expect(dedupeListings([a, b])).toHaveLength(1);
  });
});

describe("dedupeListings — bucket boundaries", () => {
  it("merges prices within the same 50k bucket (same geo)", () => {
    const base = { lat: 3.27, lng: -76.53, areaM2: 90, bedrooms: 3 };
    const a = makeListing({ ...base, source: "a", price: 1_000_000 });
    const b = makeListing({ ...base, source: "b", price: 1_020_000 }); // same bucket (20)
    expect(dedupeListings([a, b])).toHaveLength(1);
  });

  it("keeps prices in different buckets separate (same geo)", () => {
    const base = { lat: 3.27, lng: -76.53, areaM2: 90, bedrooms: 3 };
    const a = makeListing({ ...base, source: "a", price: 1_000_000 }); // bucket 20
    const b = makeListing({ ...base, source: "b", price: 1_200_000 }); // bucket 24
    expect(dedupeListings([a, b])).toHaveLength(2);
  });

  it("treats areas that round to the same integer as equal", () => {
    const base = { lat: 3.27, lng: -76.53, price: 1_000_000, bedrooms: 3 };
    const a = makeListing({ ...base, source: "a", areaM2: 86 });
    const b = makeListing({ ...base, source: "b", areaM2: 86.4 }); // rounds to 86
    expect(dedupeListings([a, b])).toHaveLength(1);
  });
});
