import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { serpSearch, hasBrightDataSerp, hasSerpProvider, serpProviderStatus } from "@/lib/providers/serpSearch";

const ENV_KEYS = ["BRIGHTDATA_API_KEY", "BRIGHTDATA_SERP_ZONE"] as const;
let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  vi.unstubAllGlobals();
});

function setEnv(key?: string, zone?: string) {
  if (key) process.env.BRIGHTDATA_API_KEY = key;
  else delete process.env.BRIGHTDATA_API_KEY;
  if (zone) process.env.BRIGHTDATA_SERP_ZONE = zone;
  else delete process.env.BRIGHTDATA_SERP_ZONE;
}

describe("hasBrightDataSerp / hasSerpProvider / serpProviderStatus", () => {
  it("false when neither env var is set", () => {
    setEnv(undefined, undefined);
    expect(hasBrightDataSerp()).toBe(false);
    expect(hasSerpProvider()).toBe(false);
    expect(serpProviderStatus()).toEqual({ brightDataSerp: false });
  });

  it("false when only the API key is set", () => {
    setEnv("k", undefined);
    expect(hasBrightDataSerp()).toBe(false);
  });

  it("false when only the zone is set", () => {
    setEnv(undefined, "zone1");
    expect(hasBrightDataSerp()).toBe(false);
  });

  it("true when both are set", () => {
    setEnv("k", "zone1");
    expect(hasBrightDataSerp()).toBe(true);
    expect(hasSerpProvider()).toBe(true);
    expect(serpProviderStatus()).toEqual({ brightDataSerp: true });
  });
});

describe("serpSearch — graceful degrade without throwing", () => {
  it("returns [] immediately when no provider is configured (no fetch call)", async () => {
    setEnv(undefined, undefined);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const results = await serpSearch("arriendo casas jamundi");
    expect(results).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns [] for a blank query without calling fetch", async () => {
    setEnv("k", "zone1");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    expect(await serpSearch("")).toEqual([]);
    expect(await serpSearch("   ")).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("serpSearch — Bright Data success path", () => {
  it("parses organic results into SerpResult[]", async () => {
    setEnv("k", "zone1");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        text: async () =>
          JSON.stringify({
            organic: [
              { link: "https://a.com/x", title: "A title", description: "A desc" },
              { link: "https://b.com/y", title: "B title", description: "B desc" },
            ],
          }),
      }),
    );
    const results = await serpSearch("arriendo casas cali");
    expect(results).toEqual([
      { url: "https://a.com/x", title: "A title", snippet: "A desc", engine: "google" },
      { url: "https://b.com/y", title: "B title", snippet: "B desc", engine: "google" },
    ]);
  });

  it("tags results with the requested engine", async () => {
    setEnv("k", "zone1");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        text: async () => JSON.stringify({ organic: [{ link: "https://a.com" }] }),
      }),
    );
    const results = await serpSearch("q", { engine: "bing" });
    expect(results[0].engine).toBe("bing");
  });

  it("google requests carry the country params (gl/hl/cr) with co/es defaults", async () => {
    setEnv("k", "zone1");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ organic: [{ link: "https://a.com" }] }),
    });
    vi.stubGlobal("fetch", fetchMock);
    await serpSearch("arriendo casas cali");
    const sentUrl = new URL((fetchMock.mock.calls[0][1] as { body: string }).body.match(/"url":"([^"]+)"/)![1].replace(/\\u0026/g, "&"));
    expect(sentUrl.searchParams.get("gl")).toBe("co");
    expect(sentUrl.searchParams.get("hl")).toBe("es");
    expect(sentUrl.searchParams.get("cr")).toBe("countryCO");
  });

  it("google country params are configurable per call", async () => {
    setEnv("k", "zone1");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ organic: [{ link: "https://a.com" }] }),
    });
    vi.stubGlobal("fetch", fetchMock);
    await serpSearch("departamentos santiago", { country: "cl", language: "es" });
    const sentUrl = new URL((fetchMock.mock.calls[0][1] as { body: string }).body.match(/"url":"([^"]+)"/)![1].replace(/\\u0026/g, "&"));
    expect(sentUrl.searchParams.get("gl")).toBe("cl");
    expect(sentUrl.searchParams.get("cr")).toBe("countryCL");
  });

  it("bing requests do NOT get the Google-only country params", async () => {
    setEnv("k", "zone1");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ organic: [{ link: "https://a.com" }] }),
    });
    vi.stubGlobal("fetch", fetchMock);
    await serpSearch("q", { engine: "bing" });
    const sentUrl = new URL((fetchMock.mock.calls[0][1] as { body: string }).body.match(/"url":"([^"]+)"/)![1].replace(/\\u0026/g, "&"));
    expect(sentUrl.searchParams.get("cr")).toBeNull();
    expect(sentUrl.searchParams.get("gl")).toBeNull();
    expect(sentUrl.searchParams.get("hl")).toBeNull();
  });

  it("skips organic entries missing a link", async () => {
    setEnv("k", "zone1");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        text: async () =>
          JSON.stringify({ organic: [{ title: "no link here" }, { link: "https://ok.com" }] }),
      }),
    );
    const results = await serpSearch("q");
    expect(results).toHaveLength(1);
    expect(results[0].url).toBe("https://ok.com");
  });

  it("defaults title/snippet to empty strings when absent", async () => {
    setEnv("k", "zone1");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        text: async () => JSON.stringify({ organic: [{ link: "https://a.com" }] }),
      }),
    );
    const results = await serpSearch("q");
    expect(results[0]).toEqual({ url: "https://a.com", title: "", snippet: "", engine: "google" });
  });
});

describe("serpSearch — malformed / failure handling (never throws)", () => {
  it("returns [] on a non-ok HTTP response", async () => {
    setEnv("k", "zone1");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, text: async () => "" }));
    expect(await serpSearch("q")).toEqual([]);
  });

  it("returns [] on malformed (non-JSON) response body", async () => {
    setEnv("k", "zone1");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, text: async () => "not json{{{" }));
    expect(await serpSearch("q")).toEqual([]);
  });

  it("returns [] when the response JSON has no organic array", async () => {
    setEnv("k", "zone1");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, text: async () => JSON.stringify({}) }));
    expect(await serpSearch("q")).toEqual([]);
  });

  it("returns [] when 'organic' is present but not an array", async () => {
    setEnv("k", "zone1");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, text: async () => JSON.stringify({ organic: "oops" }) }),
    );
    expect(await serpSearch("q")).toEqual([]);
  });

  it("returns [] when fetch itself rejects (network error)", async () => {
    setEnv("k", "zone1");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    await expect(serpSearch("q")).resolves.toEqual([]);
  });

  it("returns [] on an abort/timeout", async () => {
    setEnv("k", "zone1");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => {
        const err = new Error("aborted");
        err.name = "AbortError";
        return Promise.reject(err);
      }),
    );
    await expect(serpSearch("q", { timeoutMs: 5 })).resolves.toEqual([]);
  });
});
