/**
 * Per-property review state (Vista / Elegible), shared across every view and
 * every saved search. Keyed by the property's underlying source URLs so the
 * same property — even when merged differently across searches — resolves to
 * the same review everywhere.
 */

export interface ReviewState {
  seen?: boolean;
  eligible?: boolean;
}

export type ReviewStore = Record<string, ReviewState>;

export const REVIEW_KEY = "ca_reviews";

/** Minimal shape needed to derive a property's identity keys. */
export interface Reviewable {
  source: string;
  sourceListingId: string;
  url: string;
  sourceLinks?: { source: string; url: string }[];
}

/** All stable identity keys for a listing (its source URLs + source:id). */
export function listingKeys(l: Reviewable): string[] {
  const keys = new Set<string>();
  for (const s of l.sourceLinks ?? []) {
    if (s.url) keys.add(`u:${s.url}`);
  }
  if (l.url) keys.add(`u:${l.url}`);
  keys.add(`s:${l.source}:${l.sourceListingId}`);
  return [...keys];
}

/** Effective review for a listing: marked if ANY of its keys is marked. */
export function getReview(store: ReviewStore, l: Reviewable): ReviewState {
  let seen = false;
  let eligible = false;
  for (const k of listingKeys(l)) {
    const s = store[k];
    if (s) {
      if (s.seen) seen = true;
      if (s.eligible) eligible = true;
    }
  }
  return { seen, eligible };
}

/** Write a patch to ALL of a listing's keys (so it propagates everywhere). */
export function setReview(store: ReviewStore, l: Reviewable, patch: ReviewState): ReviewStore {
  const next: ReviewStore = { ...store };
  for (const k of listingKeys(l)) {
    next[k] = { ...next[k], ...patch };
  }
  return next;
}
