import type { ResultMeta, ResultPayload } from "@/components/ResultsView";
import { trySaveJSON } from "@/lib/clientStore";

/** A persisted past search (params + a snapshot of its results). */
export interface HistoryEntry<F = unknown> {
  id: string;
  ts: number;
  /** dedup key: identical searches replace each other instead of piling up */
  sig: string;
  mode: "scrape" | "list";
  label: string;
  form: F;
  meta: ResultMeta;
  result: ResultPayload;
}

export const HISTORY_KEY = "ca_history";
export const DEFAULT_MAX_HISTORY = 15;

/**
 * Add an entry to the history: remove any existing entry with the same signature
 * (so re-running the same search updates in place), prepend, and cap the length.
 * Pure — does no I/O.
 */
export function addEntry<F>(
  list: HistoryEntry<F>[],
  entry: HistoryEntry<F>,
  max = DEFAULT_MAX_HISTORY,
): HistoryEntry<F>[] {
  const deduped = list.filter((e) => e.sig !== entry.sig);
  return [entry, ...deduped].slice(0, max);
}

export function removeEntry<F>(list: HistoryEntry<F>[], id: string): HistoryEntry<F>[] {
  return list.filter((e) => e.id !== id);
}

/** Keep stored snapshots bounded: full Top, but cap the long table to `maxRanked`. */
export function trimResult(result: ResultPayload, maxRanked = 100): ResultPayload {
  if (!result.ranked || result.ranked.length <= maxRanked) return result;
  return { ...result, ranked: result.ranked.slice(0, maxRanked) };
}

function capEntries<F>(list: HistoryEntry<F>[], maxRanked: number): HistoryEntry<F>[] {
  return list.map((e) => ({ ...e, result: trimResult(e.result, maxRanked) }));
}

/**
 * Persist the whole history, degrading gracefully if localStorage is full:
 * store full snapshots when they fit; otherwise progressively cap each entry's
 * results table, then drop the oldest entries. Returns the list actually saved
 * so React state stays in sync with storage.
 */
export function saveHistory<F>(list: HistoryEntry<F>[]): HistoryEntry<F>[] {
  if (typeof window === "undefined") return list;
  if (trySaveJSON(HISTORY_KEY, list)) return list;

  for (const cap of [300, 100, 30]) {
    const capped = capEntries(list, cap);
    if (trySaveJSON(HISTORY_KEY, capped)) return capped;
  }
  // last resort: keep fewer, capped entries
  let capped = capEntries(list, 30);
  while (capped.length > 1) {
    capped = capped.slice(0, capped.length - 1);
    if (trySaveJSON(HISTORY_KEY, capped)) return capped;
  }
  trySaveJSON(HISTORY_KEY, capped);
  return capped;
}
