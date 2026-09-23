import { describe, it, expect } from "vitest";
import { dedupeListings } from "@/lib/core/dedup";
import { makeListing } from "./helpers";

describe("dedupeListings", () => {
  it("merges the same property across sources, preferring the one with a phone", () => {
    const a = makeListing({
      source: "fincaraiz",
      lat: 3.275,
      lng: -76.535,
      price: 1300000,
      areaM2: 86,
      bedrooms: 2,
      phone: null,
      estrato: 3,
    });
    const b = makeListing({
      source: "ciencuadras",
      lat: 3.2751,
      lng: -76.5349,
      price: 1290000, // within the 50k bucket
      areaM2: 86,
      bedrooms: 2,
      phone: "3160001122",
      estrato: null,
    });
    const merged = dedupeListings([a, b]);
    expect(merged).toHaveLength(1);
    const m = merged[0];
    expect(m.mergedSources.sort()).toEqual(["ciencuadras", "fincaraiz"]);
    expect(m.phone).toBe("3160001122"); // phone-bearing record preferred
    expect(m.estrato).toBe(3); // missing field filled from the other source
  });

  it("keeps distinct properties separate", () => {
    const a = makeListing({ lat: 3.27, lng: -76.53, price: 1000000, areaM2: 80, bedrooms: 2 });
    const b = makeListing({ lat: 3.40, lng: -76.55, price: 3000000, areaM2: 150, bedrooms: 4 });
    expect(dedupeListings([a, b])).toHaveLength(2);
  });

  it("falls back to text signature when geo is missing", () => {
    const a = makeListing({ lat: null, lng: null, barrio: "Pance", conjunto: "Reserva", price: 2000000, areaM2: 100 });
    const b = makeListing({ source: "other", lat: null, lng: null, barrio: "Pance", conjunto: "Reserva", price: 2010000, areaM2: 100 });
    expect(dedupeListings([a, b])).toHaveLength(1);
  });
});
