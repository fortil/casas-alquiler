/**
 * Per-domain review state for the site-discovery feature (Revisado /
 * Priorizado), persisted client-side. Same two-flag + localStorage + colored-
 * row convention as `lib/reviewStore.ts`, but keyed by root domain instead of
 * listing identity.
 */
import type { CandidateSource } from "@/lib/core/discovery/pipeline";

export interface DiscoverReviewState {
  reviewed?: boolean;
  prioritized?: boolean;
}

export type DiscoverReviewStore = Record<string, DiscoverReviewState>;

export const DISCOVER_REVIEW_KEY = "ca_discover_reviews";
export const DISCOVER_CANDIDATES_KEY = "ca_discover_candidates";

export function getDiscoverReview(store: DiscoverReviewStore, domain: string): DiscoverReviewState {
  return store[domain] ?? {};
}

export function setDiscoverReview(
  store: DiscoverReviewStore,
  domain: string,
  patch: DiscoverReviewState,
): DiscoverReviewStore {
  return { ...store, [domain]: { ...store[domain], ...patch } };
}

/**
 * Backfill `recon.country` on candidates persisted before the field existed.
 * localStorage holds untyped JSON, so a candidate saved by an older run has a
 * recon object with no `country` — reading it verbatim crashes the UI.
 */
export function hydrateCandidates(list: CandidateSource[]): CandidateSource[] {
  return list.map((c) =>
    c?.recon && !c.recon.country
      ? { ...c, recon: { ...c.recon, country: { verdict: "unknown", evidence: [] } } }
      : c,
  );
}

/**
 * Merge freshly-discovered candidates into a previously-persisted list:
 * dedupe by domain, keep the newer recon (by `discoveredAt`), and union
 * `foundVia` entries (by URL) so repeated runs accumulate evidence instead of
 * clobbering it.
 */
export function mergeCandidates(
  existing: CandidateSource[],
  incoming: CandidateSource[],
): CandidateSource[] {
  const byDomain = new Map<string, CandidateSource>();
  for (const c of hydrateCandidates(existing)) byDomain.set(c.domain, c);

  for (const next of incoming) {
    const prev = byDomain.get(next.domain);
    if (!prev) {
      byDomain.set(next.domain, next);
      continue;
    }
    const newer = next.discoveredAt >= prev.discoveredAt ? next : prev;
    const older = newer === next ? prev : next;

    const seenUrls = new Set(newer.foundVia.map((f) => f.url));
    const mergedFoundVia = [...newer.foundVia, ...older.foundVia.filter((f) => !seenUrls.has(f.url))];

    byDomain.set(next.domain, {
      ...newer,
      foundVia: mergedFoundVia,
      mentionCount: mergedFoundVia.length,
      // prefer whichever side actually has a recon result
      recon: newer.recon ?? older.recon,
    });
  }

  return Array.from(byDomain.values());
}
