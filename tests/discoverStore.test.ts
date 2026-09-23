import { describe, it, expect } from "vitest";
import {
  getDiscoverReview,
  setDiscoverReview,
  mergeCandidates,
  hydrateCandidates,
  type DiscoverReviewStore,
} from "@/lib/discoverStore";
import type { CandidateSource } from "@/lib/core/discovery/pipeline";
import type { CandidateRecon } from "@/lib/core/discovery/recon";

function candidate(over: Partial<CandidateSource> & { domain: string }): CandidateSource {
  return {
    status: "new",
    foundVia: [],
    mentionCount: 1,
    discoveredAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

describe("getDiscoverReview / setDiscoverReview", () => {
  it("returns an empty object for an unknown domain", () => {
    expect(getDiscoverReview({}, "unknown.com")).toEqual({});
  });

  it("round-trips a patch", () => {
    let store: DiscoverReviewStore = {};
    store = setDiscoverReview(store, "a.com", { reviewed: true });
    expect(getDiscoverReview(store, "a.com")).toEqual({ reviewed: true });
  });

  it("merging a patch does not clobber the other flag", () => {
    let store: DiscoverReviewStore = {};
    store = setDiscoverReview(store, "a.com", { reviewed: true });
    store = setDiscoverReview(store, "a.com", { prioritized: true });
    expect(getDiscoverReview(store, "a.com")).toEqual({ reviewed: true, prioritized: true });
  });

  it("unsetting one flag leaves the other untouched", () => {
    let store: DiscoverReviewStore = {};
    store = setDiscoverReview(store, "a.com", { reviewed: true, prioritized: true });
    store = setDiscoverReview(store, "a.com", { prioritized: false });
    expect(getDiscoverReview(store, "a.com")).toEqual({ reviewed: true, prioritized: false });
  });

  it("does not affect other domains", () => {
    let store: DiscoverReviewStore = {};
    store = setDiscoverReview(store, "a.com", { reviewed: true });
    store = setDiscoverReview(store, "b.com", { prioritized: true });
    expect(getDiscoverReview(store, "a.com")).toEqual({ reviewed: true });
    expect(getDiscoverReview(store, "b.com")).toEqual({ prioritized: true });
  });
});

describe("hydrateCandidates — old persisted data", () => {
  // Simulates localStorage saved before recon.country existed: the recon
  // object is complete except for the country field (a runtime shape TS
  // can't see in JSON).
  const staleRecon = {
    reachable: true,
    statusCode: 200,
    robots: { fetched: false, aiBlocked: false, blockedAgents: [] },
    antiBot: { hinted: false, signals: [] },
    relevance: 0.4,
    hasJsonLd: false,
  } as unknown as CandidateRecon;

  it("backfills a missing recon.country instead of leaving it undefined", () => {
    const [c] = hydrateCandidates([candidate({ domain: "viejo.com", recon: staleRecon })]);
    expect(c.recon?.country).toEqual({ verdict: "unknown", evidence: [] });
  });

  it("leaves candidates that already have a country verdict untouched", () => {
    const c = candidate({
      domain: "nuevo.com",
      recon: { ...staleRecon, country: { verdict: "co", evidence: ["señal CO: estrato"] } },
    });
    expect(hydrateCandidates([c])[0]).toEqual(c);
  });

  it("mergeCandidates heals stale persisted recons on the existing side", () => {
    const stale = candidate({ domain: "a.com", recon: staleRecon });
    const fresh = candidate({ domain: "b.com" });
    const merged = mergeCandidates([stale], [fresh]);
    expect(merged.find((c) => c.domain === "a.com")?.recon?.country).toEqual({
      verdict: "unknown",
      evidence: [],
    });
  });
});

describe("mergeCandidates", () => {
  it("adds a brand-new domain not seen before", () => {
    const merged = mergeCandidates([], [candidate({ domain: "a.com" })]);
    expect(merged).toHaveLength(1);
    expect(merged[0].domain).toBe("a.com");
  });

  it("dedupes by domain, keeping the newer recon", () => {
    const older = candidate({
      domain: "a.com",
      discoveredAt: "2026-01-01T00:00:00.000Z",
      recon: { reachable: false, statusCode: null, robots: { fetched: false, aiBlocked: false, blockedAgents: [] }, antiBot: { hinted: false, signals: [] }, relevance: 0, hasJsonLd: false, country: { verdict: "unknown", evidence: [] } },
    });
    const newer = candidate({
      domain: "a.com",
      discoveredAt: "2026-02-01T00:00:00.000Z",
      recon: { reachable: true, statusCode: 200, robots: { fetched: true, aiBlocked: false, blockedAgents: [] }, antiBot: { hinted: false, signals: [] }, relevance: 0.7, hasJsonLd: true, country: { verdict: "unknown", evidence: [] } },
    });
    const merged = mergeCandidates([older], [newer]);
    expect(merged).toHaveLength(1);
    expect(merged[0].recon?.reachable).toBe(true);
    expect(merged[0].recon?.relevance).toBe(0.7);
  });

  it("unions foundVia across merges, deduped by URL", () => {
    const older = candidate({
      domain: "a.com",
      discoveredAt: "2026-01-01T00:00:00.000Z",
      foundVia: [{ query: "q1", url: "https://a.com/x", title: "", engine: "google" }],
    });
    const newer = candidate({
      domain: "a.com",
      discoveredAt: "2026-02-01T00:00:00.000Z",
      foundVia: [{ query: "q2", url: "https://a.com/y", title: "", engine: "google" }],
    });
    const merged = mergeCandidates([older], [newer]);
    const urls = merged[0].foundVia.map((f) => f.url).sort();
    expect(urls).toEqual(["https://a.com/x", "https://a.com/y"]);
    expect(merged[0].mentionCount).toBe(2);
  });

  it("does not duplicate an identical URL seen in both runs", () => {
    const shared = { query: "q1", url: "https://a.com/x", title: "", engine: "google" };
    const older = candidate({ domain: "a.com", discoveredAt: "2026-01-01T00:00:00.000Z", foundVia: [shared] });
    const newer = candidate({ domain: "a.com", discoveredAt: "2026-02-01T00:00:00.000Z", foundVia: [shared] });
    const merged = mergeCandidates([older], [newer]);
    expect(merged[0].foundVia).toHaveLength(1);
  });

  it("falls back to the older recon when the newer run has none", () => {
    const older = candidate({
      domain: "a.com",
      discoveredAt: "2026-01-01T00:00:00.000Z",
      recon: { reachable: true, statusCode: 200, robots: { fetched: false, aiBlocked: false, blockedAgents: [] }, antiBot: { hinted: false, signals: [] }, relevance: 0.5, hasJsonLd: false, country: { verdict: "unknown", evidence: [] } },
    });
    const newer = candidate({ domain: "a.com", discoveredAt: "2026-02-01T00:00:00.000Z" }); // no recon
    const merged = mergeCandidates([older], [newer]);
    expect(merged[0].recon?.reachable).toBe(true);
  });

  it("preserves unrelated existing domains untouched", () => {
    const existing = [candidate({ domain: "a.com" }), candidate({ domain: "b.com" })];
    const merged = mergeCandidates(existing, [candidate({ domain: "c.com" })]);
    expect(merged.map((c) => c.domain).sort()).toEqual(["a.com", "b.com", "c.com"]);
  });

  it("handles empty existing and empty incoming lists", () => {
    expect(mergeCandidates([], [])).toEqual([]);
    expect(mergeCandidates([candidate({ domain: "a.com" })], [])).toHaveLength(1);
  });
});
