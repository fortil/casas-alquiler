import type { Listing, SourceLink } from "@/lib/core/schema";
import { isValidPoint } from "@/lib/core/schema";
import { norm, round } from "@/lib/util/text";

export type MergedListing = Listing & {
  mergedSources: string[];
  sourceLinks: SourceLink[];
};

/**
 * Collapse listings that describe the same physical property across sources.
 *
 * Signature, in priority order:
 *  1) geo signature: rounded lat/lng (~100m) + price bucket + area + bedrooms
 *  2) text signature: requires a barrio or conjunto (location anchor) +
 *     price bucket + area
 *  3) otherwise NOT mergeable — a listing with no coordinates and no
 *     barrio/conjunto is kept unique (never merge on price/area alone, which
 *     would wrongly fuse unrelated listings).
 *
 * The canonical record prefers the one with a phone (then the most complete),
 * merges missing fields from the others, and records every contributing
 * portal + URL in `sourceLinks`.
 */
export function dedupeListings(listings: Listing[]): MergedListing[] {
  const groups = new Map<string, Listing[]>();

  for (const l of listings) {
    const sig = signature(l);
    const arr = groups.get(sig);
    if (arr) arr.push(l);
    else groups.set(sig, [l]);
  }

  const result: MergedListing[] = [];
  for (const group of groups.values()) {
    result.push(mergeGroup(group));
  }
  return result;
}

function signature(l: Listing): string {
  const priceBucket = l.price != null ? Math.round(l.price / 50000) : "?";
  const area = l.areaM2 != null ? Math.round(l.areaM2) : "?";

  if (isValidPoint({ lat: l.lat ?? undefined, lng: l.lng ?? undefined })) {
    // ~3 decimals ≈ 100m, tolerant to small coord differences across portals.
    return `geo:${round(l.lat!, 3)},${round(l.lng!, 3)}|${priceBucket}|${area}|${l.bedrooms ?? "?"}`;
  }

  const barrio = norm(l.barrio);
  const conjunto = norm(l.conjunto);
  if (barrio || conjunto) {
    return `txt:${barrio}|${conjunto}|${priceBucket}|${area}`;
  }

  // No location anchor at all -> never merge with anything else.
  return `uniq:${l.source}:${l.sourceListingId}`;
}

function mergeGroup(group: Listing[]): MergedListing {
  // Prefer the record that has a phone, then the most complete one.
  const sorted = [...group].sort((a, b) => completeness(b) - completeness(a));
  const base: MergedListing = {
    ...sorted[0],
    mergedSources: uniqueStrings(group.map((g) => g.source)),
    sourceLinks: collectSourceLinks(sorted),
  };

  for (const other of sorted.slice(1)) {
    for (const k of Object.keys(other) as (keyof Listing)[]) {
      const cur = base[k];
      const next = other[k];
      if ((cur == null || cur === "") && next != null && next !== "") {
        // @ts-expect-error index assignment across union of field types
        base[k] = next;
      }
    }
    if (!base.hasWhatsapp && other.hasWhatsapp) base.hasWhatsapp = true;
  }
  return base;
}

/** One {source,url} per distinct URL, in canonical-first order. */
function collectSourceLinks(sorted: Listing[]): SourceLink[] {
  const seen = new Set<string>();
  const out: SourceLink[] = [];
  for (const l of sorted) {
    if (!l.url || seen.has(l.url)) continue;
    seen.add(l.url);
    out.push({ source: l.source, url: l.url });
  }
  return out;
}

function uniqueStrings(xs: string[]): string[] {
  return Array.from(new Set(xs));
}

function completeness(l: Listing): number {
  let n = 0;
  if (l.phone) n += 5; // phone is the scarcest, most valuable field
  if (l.lat != null && l.lng != null) n += 2;
  if (l.areaM2 != null) n += 1;
  if (l.price != null) n += 1;
  if (l.barrio) n += 1;
  if (l.conjunto) n += 1;
  if (l.estrato != null) n += 1;
  if (l.agency) n += 1;
  return n;
}
