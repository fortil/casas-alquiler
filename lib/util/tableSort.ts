import type { ScoredListing } from "@/lib/core/schema";

export type SortDir = "asc" | "desc";
export interface SortKey {
  key: string;
  dir: SortDir;
}

interface Accessor {
  type: "num" | "str";
  value: (l: ScoredListing) => number | string | null | undefined;
}

function loc(l: ScoredListing): string {
  return [l.barrio, l.conjunto].filter(Boolean).join(" / ") || l.address || "";
}

/** Sortable columns and how to read their value (single source of truth). */
export const SORT_ACCESSORS: Record<string, Accessor> = {
  rank: { type: "num", value: (l) => l.rank },
  score: { type: "num", value: (l) => l.score },
  loc: { type: "str", value: loc },
  city: { type: "str", value: (l) => l.city },
  area: { type: "num", value: (l) => l.areaM2 },
  price: { type: "num", value: (l) => l.price },
  admin: { type: "num", value: (l) => l.admin },
  cpm2: { type: "num", value: (l) => l.costPerM2 },
  dist: { type: "num", value: (l) => l.drivingKm ?? l.distanceKm ?? null },
  beds: { type: "num", value: (l) => l.bedrooms },
  estrato: { type: "num", value: (l) => l.estrato },
  agency: { type: "str", value: (l) => l.agency },
  source: { type: "str", value: (l) => (l.sources?.length ? l.sources.join("+") : l.source) },
};

export function isSortable(key: string): boolean {
  return key in SORT_ACCESSORS;
}

/** Compare two listings on one sort key. Nulls/blanks sort last in BOTH directions. */
export function compareOn(a: ScoredListing, b: ScoredListing, sk: SortKey): number {
  const acc = SORT_ACCESSORS[sk.key];
  if (!acc) return 0;
  const av = acc.value(a);
  const bv = acc.value(b);
  const an = av == null || av === "";
  const bn = bv == null || bv === "";
  if (an && bn) return 0;
  if (an) return 1;
  if (bn) return -1;
  const c =
    acc.type === "num" ? Number(av) - Number(bv) : String(av).localeCompare(String(bv), "es");
  return sk.dir === "asc" ? c : -c;
}

/**
 * Stable multi-column sort. Applies each key in priority order; ties fall back
 * to the original ranking. Returns the input untouched when no keys are set.
 */
export function sortListings(rows: ScoredListing[], sortKeys: SortKey[]): ScoredListing[] {
  if (sortKeys.length === 0) return rows;
  const arr = [...rows];
  arr.sort((a, b) => {
    for (const sk of sortKeys) {
      const c = compareOn(a, b, sk);
      if (c !== 0) return c;
    }
    return a.rank - b.rank;
  });
  return arr;
}

/**
 * Reducer for a header click: 1st click adds the key ascending, 2nd toggles to
 * descending, 3rd removes it. New keys append (cumulative priority).
 */
export function cycleSort(prev: SortKey[], key: string): SortKey[] {
  const idx = prev.findIndex((s) => s.key === key);
  if (idx === -1) return [...prev, { key, dir: "asc" }];
  if (prev[idx].dir === "asc") {
    const copy = [...prev];
    copy[idx] = { key, dir: "desc" };
    return copy;
  }
  return prev.filter((s) => s.key !== key);
}
