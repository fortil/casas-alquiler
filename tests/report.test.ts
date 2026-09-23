import { describe, it, expect } from "vitest";
import { buildReport, reportFilename } from "@/lib/core/report";
import { scoreListings } from "@/lib/core/score";
import { DEFAULT_WEIGHTS } from "@/lib/config";
import { makeEvaluated } from "./helpers";

describe("reportFilename", () => {
  it("follows reporte_YYYY-MM-DD_<tema>.md and slugifies accents", () => {
    const fn = reportFilename("Casas Jamundí & Cali", new Date("2026-06-27T10:00:00Z"));
    expect(fn).toBe("reporte_2026-06-27_casas-jamundi-cali.md");
  });
});

describe("buildReport", () => {
  it("renders summary, detail table rows and conclusions", () => {
    const ranked = scoreListings(
      [
        makeEvaluated({ barrio: "Pance", price: 1000000, areaM2: 120, distanceKm: 2 }),
        makeEvaluated({ barrio: "El Caney", price: 2500000, areaM2: 90, distanceKm: 7 }),
      ],
      DEFAULT_WEIGHTS,
    );
    const md = buildReport(ranked, {
      cities: ["jamundi", "cali"],
      refPoint: { lat: 3.37, lng: -76.53 },
      maxDistKm: 10,
      minAreaM2: 80,
      weights: DEFAULT_WEIGHTS,
      distanceMode: "haversine",
      mode: "scrape",
      totalEvaluated: 2,
      generatedAt: new Date("2026-06-27T10:00:00Z"),
    });
    expect(md).toContain("## Summary");
    expect(md).toContain("## Detail");
    expect(md).toContain("## Conclusions");
    expect(md).toContain("Pance");
    expect(md).toContain("**Date:** 2026-06-27");
    // two data rows in the table
    expect(md.split("\n").filter((l) => l.startsWith("| 1 ") || l.startsWith("| 2 ")).length).toBe(2);
  });

  it("shows exact coordinates, origin and Google Maps link for the reference point", () => {
    const ranked = scoreListings(
      [makeEvaluated({ barrio: "Pance", price: 1000000, areaM2: 120, distanceKm: 2 })],
      DEFAULT_WEIGHTS,
    );
    const md = buildReport(ranked, {
      cities: ["cali"],
      refPoint: { lat: 3.4516, lng: -76.532 },
      refLabel: "San Fernando, Cali",
      refCoordsSource: "manual",
      maxDistKm: 10,
      minAreaM2: 80,
      weights: DEFAULT_WEIGHTS,
      distanceMode: "haversine",
      mode: "scrape",
      totalEvaluated: 1,
      generatedAt: new Date("2026-06-27T10:00:00Z"),
    });
    const line = md.split("\n").find((l) => l.includes("**Reference point:**")) ?? "";
    expect(line).toContain('"San Fernando, Cali" — exact coordinates 3.4516, -76.532');
    expect(line).toContain("(manual; address used as label only)");
    expect(line).toContain("https://www.google.com/maps?q=3.4516,-76.532");
  });

  it("marks geocoded reference points accordingly", () => {
    const ranked = scoreListings(
      [makeEvaluated({ barrio: "Pance", price: 1000000, areaM2: 120, distanceKm: 2 })],
      DEFAULT_WEIGHTS,
    );
    const md = buildReport(ranked, {
      cities: ["cali"],
      refPoint: { lat: 3.4516, lng: -76.532 },
      refCoordsSource: "geocoded",
      maxDistKm: 10,
      minAreaM2: 80,
      weights: DEFAULT_WEIGHTS,
      distanceMode: "haversine",
      mode: "scrape",
      totalEvaluated: 1,
      generatedAt: new Date("2026-06-27T10:00:00Z"),
    });
    const line = md.split("\n").find((l) => l.includes("**Reference point:**")) ?? "";
    expect(line).toContain("(geocoded from address)");
  });
});
