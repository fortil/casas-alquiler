import { describe, it, expect, afterEach } from "vitest";
import { addEntry, removeEntry, trimResult, saveHistory, type HistoryEntry } from "@/lib/searchHistory";
import type { ResultPayload } from "@/components/ResultsView";

function entry(id: string, sig: string, ts = 0): HistoryEntry {
  return {
    id,
    ts,
    sig,
    mode: "scrape",
    label: id,
    form: {},
    meta: {} as HistoryEntry["meta"],
    result: { top: [], ranked: [], stats: {} } as ResultPayload,
  };
}

describe("addEntry", () => {
  it("prepends new entries (newest first)", () => {
    let list: HistoryEntry[] = [];
    list = addEntry(list, entry("a", "s1"));
    list = addEntry(list, entry("b", "s2"));
    expect(list.map((e) => e.id)).toEqual(["b", "a"]);
  });

  it("dedups by signature: re-running the same search replaces and moves to top", () => {
    let list = [entry("a", "s1"), entry("b", "s2")];
    list = addEntry(list, entry("a2", "s1")); // same sig as 'a'
    expect(list.map((e) => e.id)).toEqual(["a2", "b"]);
    expect(list).toHaveLength(2);
  });

  it("caps the history length", () => {
    let list: HistoryEntry[] = [];
    for (let i = 0; i < 20; i++) list = addEntry(list, entry(`e${i}`, `s${i}`), 5);
    expect(list).toHaveLength(5);
    expect(list[0].id).toBe("e19"); // newest kept
  });
});

describe("removeEntry", () => {
  it("removes by id", () => {
    const list = [entry("a", "s1"), entry("b", "s2")];
    expect(removeEntry(list, "a").map((e) => e.id)).toEqual(["b"]);
  });
});

describe("trimResult", () => {
  it("caps the ranked array but keeps the top", () => {
    const ranked = Array.from({ length: 150 }, (_, i) => ({ rank: i + 1 })) as ResultPayload["ranked"];
    const result = { top: ranked.slice(0, 10), ranked, stats: {} } as ResultPayload;
    const trimmed = trimResult(result, 100);
    expect(trimmed.ranked).toHaveLength(100);
    expect(trimmed.top).toHaveLength(10);
  });

  it("returns the result unchanged when small", () => {
    const result = { top: [], ranked: [{ rank: 1 }], stats: {} } as unknown as ResultPayload;
    expect(trimResult(result, 100)).toBe(result);
  });
});

describe("saveHistory — quota degradation", () => {
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it("caps entries until they fit a small localStorage quota", () => {
    const store: Record<string, string> = {};
    const LIMIT = 2000;
    (globalThis as { window?: unknown }).window = {
      localStorage: {
        setItem(k: string, v: string) {
          if (v.length > LIMIT) throw new Error("QuotaExceeded");
          store[k] = v;
        },
        getItem: (k: string) => store[k] ?? null,
        removeItem: (k: string) => {
          delete store[k];
        },
      },
    };
    const bigRanked = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ rank: i + 1 })) as unknown as ResultPayload["ranked"];
    const list: HistoryEntry[] = [entry("a", "s1"), entry("b", "s2")].map((e) => ({
      ...e,
      result: { top: [], ranked: bigRanked(200), stats: {} } as ResultPayload,
    }));

    const saved = saveHistory(list);

    // It persisted *something* within the quota, and capped the ranked arrays.
    expect(store["ca_history"]).toBeTruthy();
    expect(store["ca_history"].length).toBeLessThanOrEqual(LIMIT);
    expect(saved.length).toBeGreaterThan(0);
    expect(Math.max(...saved.map((e) => e.result.ranked.length))).toBeLessThan(200);
  });
});
