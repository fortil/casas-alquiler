import { describe, it, expect } from "vitest";
import { buildDiscoveryQueries } from "@/lib/core/discovery/queryBuilder";

describe("buildDiscoveryQueries — multi-city generation", () => {
  it("builds 4 per-city queries plus the generic one, for two cities", () => {
    const qs = buildDiscoveryQueries({ cities: ["jamundi", "cali"], propertyType: "casa", zoneSampleSize: 0 });
    // 4 per city * 2 cities + 1 generic = 9 (no zone queries since zoneSampleSize=0)
    expect(qs).toHaveLength(9);
    expect(qs).toContain("arriendo casas Jamundí Colombia");
    expect(qs).toContain("inmobiliaria Jamundí Colombia arriendo casas");
    expect(qs).toContain("casa en arriendo Jamundí Valle del Cauca Colombia");
    expect(qs).toContain("site:.co arriendo casas Jamundí Colombia");
    expect(qs).toContain("arriendo casas Cali Colombia");
    expect(qs).toContain("portales de arriendo de vivienda en Colombia");
  });

  it("anchors the country in EVERY query, zones included", () => {
    const qs = buildDiscoveryQueries({ cities: ["jamundi", "cali"], propertyType: "apartamento" });
    expect(qs.length).toBeGreaterThan(0);
    for (const q of qs) expect(q.toLowerCase()).toContain("colombia");
  });

  it("pluralizes apartamento correctly", () => {
    const qs = buildDiscoveryQueries({ cities: ["cali"], propertyType: "apartamento", zoneSampleSize: 0 });
    expect(qs).toContain("arriendo apartamentos Cali Colombia");
    expect(qs).toContain("site:.co arriendo apartamentos Cali Colombia");
  });

  it("falls back to a title-cased slug for an unknown city", () => {
    const qs = buildDiscoveryQueries({ cities: ["yumbo"], propertyType: "casa", zoneSampleSize: 0 });
    expect(qs.some((q) => q.includes("Yumbo"))).toBe(true);
  });
});

describe("buildDiscoveryQueries — zone sampling", () => {
  it("samples zones only when 'cali' is among the cities", () => {
    const withCali = buildDiscoveryQueries({ cities: ["cali"], propertyType: "casa" });
    const withoutCali = buildDiscoveryQueries({ cities: ["jamundi"], propertyType: "casa" });
    expect(withCali.some((q) => / Cali Colombia$/.test(q) && q.startsWith("arriendo casa "))).toBe(true);
    expect(withoutCali.some((q) => q.startsWith("arriendo casa "))).toBe(false);
  });

  it("caps zone queries to zoneSampleSize (default 3), not all 19+ zones", () => {
    const qs = buildDiscoveryQueries({ cities: ["cali"], propertyType: "casa" });
    const zoneQueries = qs.filter((q) => q.startsWith("arriendo casa ") && q.endsWith(" Cali Colombia"));
    expect(zoneQueries.length).toBe(3);
  });

  it("zone queries include both the city and the country", () => {
    const qs = buildDiscoveryQueries({
      cities: ["cali"],
      propertyType: "casa",
      zones: ["pance", "el caney"],
      zoneSampleSize: 2,
    });
    expect(qs).toContain("arriendo casa Pance Cali Colombia");
    expect(qs).toContain("arriendo casa El Caney Cali Colombia");
  });

  it("zoneSampleSize: 0 emits no zone-specific queries", () => {
    const qs = buildDiscoveryQueries({ cities: ["cali"], propertyType: "casa", zoneSampleSize: 0 });
    expect(qs.some((q) => q.startsWith("arriendo casa "))).toBe(false);
  });
});

describe("buildDiscoveryQueries — query budget", () => {
  it("a default two-city run builds 12 queries (4 per city + 1 generic + 3 zones)", () => {
    expect(buildDiscoveryQueries({ cities: ["jamundi", "cali"], propertyType: "casa" })).toHaveLength(12);
  });

  it("site:.co queries survive the default maxQueries cap of 12", () => {
    const qs = buildDiscoveryQueries({ cities: ["jamundi", "cali"], propertyType: "casa", maxQueries: 12 });
    const dotCo = qs.filter((q) => q.startsWith("site:.co"));
    expect(dotCo).toHaveLength(2);
    expect(dotCo).toContain("site:.co arriendo casas Cali Colombia");
  });
});

describe("buildDiscoveryQueries — maxQueries truncation", () => {
  it("truncates deterministically to the first N queries", () => {
    const full = buildDiscoveryQueries({ cities: ["jamundi", "cali"], propertyType: "casa" });
    const capped = buildDiscoveryQueries({ cities: ["jamundi", "cali"], propertyType: "casa", maxQueries: 4 });
    expect(capped).toHaveLength(4);
    expect(capped).toEqual(full.slice(0, 4));
  });

  it("maxQueries larger than the built list returns everything", () => {
    const full = buildDiscoveryQueries({ cities: ["jamundi"], propertyType: "casa", zoneSampleSize: 0 });
    const capped = buildDiscoveryQueries({ cities: ["jamundi"], propertyType: "casa", zoneSampleSize: 0, maxQueries: 999 });
    expect(capped).toEqual(full);
  });

  it("maxQueries of 0 or negative is treated as 'no cap'", () => {
    const full = buildDiscoveryQueries({ cities: ["jamundi"], propertyType: "casa" });
    expect(buildDiscoveryQueries({ cities: ["jamundi"], propertyType: "casa", maxQueries: 0 })).toEqual(full);
    expect(buildDiscoveryQueries({ cities: ["jamundi"], propertyType: "casa", maxQueries: -5 })).toEqual(full);
  });
});

describe("buildDiscoveryQueries — empty cities degrades gracefully", () => {
  it("still returns at least the generic query", () => {
    const qs = buildDiscoveryQueries({ cities: [], propertyType: "casa" });
    expect(qs.length).toBeGreaterThanOrEqual(1);
    expect(qs).toContain("portales de arriendo de vivienda en Colombia");
  });

  it("emits no zone queries when cities is empty (no Cali present)", () => {
    const qs = buildDiscoveryQueries({ cities: [], propertyType: "casa" });
    expect(qs.some((q) => q.startsWith("arriendo casa "))).toBe(false);
  });
});

describe("buildDiscoveryQueries — determinism", () => {
  it("returns the exact same array for the same input, called twice", () => {
    const input = { cities: ["jamundi", "cali"], propertyType: "casa" as const };
    expect(buildDiscoveryQueries(input)).toEqual(buildDiscoveryQueries(input));
  });

  it("stable ordering: per-city queries before the generic, before zone queries", () => {
    const qs = buildDiscoveryQueries({ cities: ["jamundi"], propertyType: "casa", zoneSampleSize: 0 });
    const genericIdx = qs.indexOf("portales de arriendo de vivienda en Colombia");
    expect(genericIdx).toBe(qs.length - 1); // last, since no zones follow for jamundi-only
  });
});
