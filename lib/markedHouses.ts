import type { HistoryEntry } from "@/lib/searchHistory";
import type { ScoredListing } from "@/lib/core/schema";
import { getReview, listingKeys, type ReviewStore, type ReviewState } from "@/lib/reviewStore";

export type ReviewLabel = "eligible" | "seen" | "none";

export interface MarkedHouse {
  listing: ScoredListing;
  state: ReviewLabel;
  review: ReviewState;
  /** reference-point label of the (newest) search this snapshot came from */
  refLabel?: string;
}

export function reviewLabel(r: ReviewState): ReviewLabel {
  if (r.eligible) return "eligible";
  if (r.seen) return "seen";
  return "none";
}

/**
 * Gather every house across all saved searches, deduped across histories by
 * intersecting review keys (the same identity logic used to mark houses).
 * History is newest-first, so the first occurrence — the newest snapshot —
 * wins, fixing the distance/cost to that search's reference point.
 */
export function collectMarked(
  history: HistoryEntry[],
  reviews: ReviewStore,
): MarkedHouse[] {
  const seen = new Set<string>();
  const out: MarkedHouse[] = [];
  for (const entry of history) {
    const ranked = entry?.result?.ranked ?? [];
    for (const l of ranked) {
      const keys = listingKeys(l);
      const dup = keys.some((k) => seen.has(k));
      // register keys even on the skip branch so transitive aliases collapse
      // (house under url-a in one search and url-b in another, both in a third)
      for (const k of keys) seen.add(k);
      if (dup) continue;
      const review = getReview(reviews, l);
      out.push({ listing: l, state: reviewLabel(review), review, refLabel: entry?.meta?.refLabel });
    }
  }
  return out;
}

export function stateCounts(items: MarkedHouse[]): Record<ReviewLabel, number> {
  const c: Record<ReviewLabel, number> = { eligible: 0, seen: 0, none: 0 };
  for (const m of items) c[m.state]++;
  return c;
}

/** Keep only the selected states. Empty selection => nothing. */
export function filterByState(items: MarkedHouse[], selected: ReviewLabel[]): MarkedHouse[] {
  if (selected.length === 0) return [];
  const set = new Set(selected);
  return items.filter((m) => set.has(m.state));
}

export const EXPORT_HEADERS = [
  "Barrio/Conjunto",
  "Ciudad",
  "m²",
  "Precio",
  "$/m²",
  "Distancia (km)",
  "Habitaciones",
  "Estado",
  "Enlace",
] as const;

export interface ExportRow {
  "Barrio/Conjunto": string;
  Ciudad: string;
  "m²": number | null;
  Precio: number | null;
  "$/m²": number | null;
  "Distancia (km)": number | null;
  Habitaciones: number | null;
  Estado: string;
  Enlace: string;
}

/** Guard against CSV/Excel formula injection: prefix risky leading chars. */
export function sanitizeCell(v: string): string {
  if (v && /^[=+\-@\t\r]/.test(v)) return "'" + v;
  return v;
}

function estadoEs(s: ReviewLabel): string {
  return s === "eligible" ? "Elegible" : s === "seen" ? "Vista" : "Sin estado";
}

export function toExportRow(m: MarkedHouse): ExportRow {
  const l = m.listing;
  const loc = [l.barrio, l.conjunto].filter(Boolean).join(" / ") || l.address || "";
  const dist = l.drivingKm ?? l.distanceKm ?? null;
  const link = l.url && !l.url.startsWith("https://manual.local") ? l.url : "";
  return {
    "Barrio/Conjunto": sanitizeCell(loc),
    Ciudad: sanitizeCell(l.city ?? ""),
    "m²": l.areaM2 ?? null,
    Precio: l.price ?? null,
    "$/m²": l.costPerM2 != null ? Math.round(l.costPerM2) : null,
    "Distancia (km)": dist != null ? Math.round(dist * 10) / 10 : null,
    Habitaciones: l.bedrooms ?? null,
    Estado: estadoEs(m.state),
    Enlace: sanitizeCell(link),
  };
}
