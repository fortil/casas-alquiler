import { describe, it, expect } from "vitest";
import {
  reviewLabel,
  collectMarked,
  stateCounts,
  filterByState,
  toExportRow,
  sanitizeCell,
  EXPORT_HEADERS,
  type MarkedHouse,
} from "@/lib/markedHouses";
import { setReview, type ReviewStore } from "@/lib/reviewStore";
import type { ScoredListing } from "@/lib/core/schema";
import type { HistoryEntry } from "@/lib/searchHistory";

function mk(over: Partial<ScoredListing> & { id: string; url: string }): ScoredListing {
  return {
    source: "s",
    sourceListingId: over.id,
    title: null,
    barrio: "Pance",
    conjunto: null,
    city: "Cali",
    address: null,
    lat: 3.4,
    lng: -76.5,
    geocodePrecision: "source",
    areaM2: 100,
    bedrooms: 3,
    bathrooms: 2,
    parking: 1,
    price: 2_000_000,
    admin: 0,
    estrato: 4,
    currency: "COP",
    agency: null,
    phone: null,
    hasWhatsapp: false,
    distanceKm: 5,
    costPerM2: 20_000,
    score: 0.5,
    rank: 1,
    ...over,
  } as ScoredListing;
}

function entry(ranked: ScoredListing[] | undefined, refLabel = "Ref", ts = 0): HistoryEntry {
  return {
    id: `e${ts}`,
    ts,
    sig: `sig${ts}`,
    mode: "scrape",
    label: "x",
    form: {},
    meta: { cities: [], refPoint: { lat: 0, lng: 0 }, refLabel, maxDistKm: 10, minAreaM2: 0, weights: { wCost: 1, wArea: 1, wDist: 1 }, distanceMode: "haversine" },
    result: { top: [], ranked: ranked as ScoredListing[], stats: {} },
  } as HistoryEntry;
}

describe("reviewLabel", () => {
  it("eligible > seen > none", () => {
    expect(reviewLabel({ eligible: true, seen: true })).toBe("eligible");
    expect(reviewLabel({ seen: true })).toBe("seen");
    expect(reviewLabel({})).toBe("none");
  });
});

describe("collectMarked — dedup", () => {
  it("collapses the same house across two histories", () => {
    const a = mk({ id: "1", url: "https://a" });
    const b = mk({ id: "1", url: "https://a" });
    expect(collectMarked([entry([a]), entry([b])], {})).toHaveLength(1);
  });

  it("dedups across different canonical sources sharing a source URL", () => {
    const newer = mk({ id: "1", url: "https://properati/x", source: "properati", sourceLinks: [
      { source: "properati", url: "https://properati/x" }, { source: "fincaraiz", url: "https://fincaraiz/y" }] });
    const older = mk({ id: "2", url: "https://fincaraiz/y", source: "fincaraiz", sourceLinks: [
      { source: "fincaraiz", url: "https://fincaraiz/y" }] });
    expect(collectMarked([entry([newer]), entry([older])], {})).toHaveLength(1);
  });

  it("collapses transitive aliases via skip-branch key registration (X:a, W:a+c, V:c)", () => {
    const X = mk({ id: "1", url: "https://a", sourceLinks: [{ source: "s", url: "https://a" }] });
    const W = mk({ id: "2", url: "https://a", sourceLinks: [{ source: "s", url: "https://a" }, { source: "s", url: "https://c" }] });
    const V = mk({ id: "3", url: "https://c", sourceLinks: [{ source: "s", url: "https://c" }] });
    expect(collectMarked([entry([X]), entry([W]), entry([V])], {})).toHaveLength(1);
  });

  it("keeps the newest snapshot's distance", () => {
    const newer = mk({ id: "1", url: "https://a", distanceKm: 2 });
    const older = mk({ id: "1", url: "https://a", distanceKm: 9 });
    const out = collectMarked([entry([newer]), entry([older])], {});
    expect(out[0].listing.distanceKm).toBe(2);
  });

  it("tolerates undefined/empty ranked and empty history", () => {
    expect(collectMarked([entry(undefined)], {})).toEqual([]);
    expect(collectMarked([entry([])], {})).toEqual([]);
    expect(collectMarked([], {})).toEqual([]);
  });

  it("attaches review state from the store", () => {
    const a = mk({ id: "1", url: "https://a" });
    let store: ReviewStore = {};
    store = setReview(store, a, { eligible: true });
    const out = collectMarked([entry([a])], store);
    expect(out[0].state).toBe("eligible");
  });
});

describe("stateCounts / filterByState", () => {
  const items: MarkedHouse[] = [
    { listing: mk({ id: "1", url: "u1" }), state: "eligible", review: { eligible: true } },
    { listing: mk({ id: "2", url: "u2" }), state: "seen", review: { seen: true } },
    { listing: mk({ id: "3", url: "u3" }), state: "none", review: {} },
    { listing: mk({ id: "4", url: "u4" }), state: "eligible", review: { eligible: true } },
  ];
  it("counts per state", () => {
    expect(stateCounts(items)).toEqual({ eligible: 2, seen: 1, none: 1 });
  });
  it("filters by selected states; empty selection => nothing", () => {
    expect(filterByState(items, ["eligible"])).toHaveLength(2);
    expect(filterByState(items, ["seen", "none"])).toHaveLength(2);
    expect(filterByState(items, [])).toHaveLength(0);
  });
});

describe("toExportRow", () => {
  it("maps fields, prefers drivingKm, keeps numbers numeric", () => {
    const l = mk({ id: "1", url: "https://a", areaM2: 86, price: 1_300_000, costPerM2: 15123.7, bedrooms: 3, drivingKm: 4.27, distanceKm: 9 });
    const row = toExportRow({ listing: l, state: "eligible", review: { eligible: true } });
    expect(row["m²"]).toBe(86);
    expect(row["Precio"]).toBe(1_300_000);
    expect(row["$/m²"]).toBe(15124); // rounded
    expect(row["Distancia (km)"]).toBe(4.3); // drivingKm preferred, 1 decimal
    expect(row["Habitaciones"]).toBe(3);
    expect(row["Estado"]).toBe("Elegible");
    expect(row["Enlace"]).toBe("https://a");
  });
  it("blanks the link for manual.local rows and keeps null numbers null", () => {
    const l = mk({ id: "1", url: "https://manual.local/row-1", areaM2: null, price: null, costPerM2: null as unknown as number, bedrooms: null, distanceKm: null, drivingKm: null });
    const row = toExportRow({ listing: l, state: "none", review: {} });
    expect(row["Enlace"]).toBe("");
    expect(row["m²"]).toBeNull();
    expect(row["Precio"]).toBeNull();
    expect(row["Distancia (km)"]).toBeNull();
    expect(row["Estado"]).toBe("Sin estado");
  });
});

describe("sanitizeCell", () => {
  it("prefixes formula-trigger characters, leaves benign text untouched", () => {
    for (const v of ["=SUM(A1)", "+1", "-1", "@x", "\tx", "\rx"]) {
      expect(sanitizeCell(v).startsWith("'")).toBe(true);
    }
    expect(sanitizeCell("Pance / Bambú")).toBe("Pance / Bambú");
    expect(sanitizeCell("")).toBe("");
    expect(sanitizeCell("https://x.com/a")).toBe("https://x.com/a");
  });
});

describe("EXPORT_HEADERS", () => {
  it("are in the agreed order", () => {
    expect(EXPORT_HEADERS).toEqual([
      "Barrio/Conjunto",
      "Ciudad",
      "m²",
      "Precio",
      "$/m²",
      "Distancia (km)",
      "Habitaciones",
      "Estado",
      "Enlace",
    ]);
  });
});
