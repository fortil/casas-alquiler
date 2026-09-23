import { describe, it, expect } from "vitest";
import { haversineKm, precisionToleranceKm } from "@/lib/core/distance";

describe("haversineKm", () => {
  it("is zero for identical points", () => {
    expect(haversineKm({ lat: 3.4, lng: -76.5 }, { lat: 3.4, lng: -76.5 })).toBe(0);
  });

  it("approximates 111km per degree of latitude", () => {
    const d = haversineKm({ lat: 3.0, lng: -76.5 }, { lat: 4.0, lng: -76.5 });
    expect(d).toBeGreaterThan(110);
    expect(d).toBeLessThan(112);
  });

  it("computes a realistic Cali↔Jamundí distance (~15-25km)", () => {
    const cali = { lat: 3.4516, lng: -76.532 };
    const jamundi = { lat: 3.2616, lng: -76.5417 };
    const d = haversineKm(cali, jamundi);
    expect(d).toBeGreaterThan(15);
    expect(d).toBeLessThan(25);
  });
});

describe("precisionToleranceKm", () => {
  it("gives more slack to coarser geocodes", () => {
    expect(precisionToleranceKm("rooftop")).toBeLessThan(precisionToleranceKm("barrio_centroid"));
    expect(precisionToleranceKm("barrio_centroid")).toBeLessThan(precisionToleranceKm("city"));
    expect(precisionToleranceKm(null)).toBe(precisionToleranceKm("city"));
  });
});
