import { describe, it, expect, vi, beforeEach } from "vitest";
import { runDiscovery } from "@/lib/core/discovery/pipeline";
import { serpSearch } from "@/lib/providers/serpSearch";
import { reconDomain } from "@/lib/core/discovery/recon";

vi.mock("@/lib/providers/serpSearch", () => ({ serpSearch: vi.fn() }));
vi.mock("@/lib/core/discovery/recon", () => ({ reconDomain: vi.fn() }));

const mockSerp = vi.mocked(serpSearch);
const mockRecon = vi.mocked(reconDomain);

function serpResult(url: string, title = "", engine: "google" | "bing" = "google") {
  return { url, title, snippet: "", engine };
}

beforeEach(() => {
  mockSerp.mockReset();
  mockRecon.mockReset();
  mockRecon.mockResolvedValue({
    reachable: true,
    statusCode: 200,
    robots: { fetched: false, aiBlocked: false, blockedAgents: [] },
    antiBot: { hinted: false, signals: [] },
    relevance: 0.5,
    hasJsonLd: false,
    country: { verdict: "unknown", evidence: [] },
  });
});

describe("runDiscovery — dedup across queries", () => {
  it("merges overlapping domains found via different queries", async () => {
    mockSerp.mockImplementation(async (query: string) => {
      if (query.includes("Jamundí Valle del Cauca")) return [serpResult("https://a.com/y", "Y")];
      if (query.startsWith("arriendo casas")) return [serpResult("https://a.com/x", "X")];
      return [];
    });

    const result = await runDiscovery({ cities: ["jamundi"], propertyType: "casa" });
    const aCom = result.candidates.find((c) => c.domain === "a.com");
    expect(aCom).toBeDefined();
    expect(aCom!.mentionCount).toBe(2);
    expect(aCom!.foundVia.map((f) => f.url).sort()).toEqual(["https://a.com/x", "https://a.com/y"]);
  });
});

describe("runDiscovery — resilience to partial failures", () => {
  it("a failing query does not abort the others; failure is recorded in errors", async () => {
    mockSerp.mockImplementation(async (query: string) => {
      if (query.includes("Valle del Cauca")) throw new Error("boom");
      return [serpResult("https://ok.com/1")];
    });

    const result = await runDiscovery({ cities: ["jamundi"], propertyType: "casa" });
    expect(result.candidates.some((c) => c.domain === "ok.com")).toBe(true);
    expect(result.errors.some((e) => e.includes("boom"))).toBe(true);
  });

  it("a failing recon does not drop the candidate from the output", async () => {
    mockSerp.mockImplementation(async (query: string) =>
      query.startsWith("portales de arriendo") ? [serpResult("https://newsite.com/x")] : [],
    );
    mockRecon.mockRejectedValueOnce(new Error("recon failed"));

    const result = await runDiscovery({ cities: ["jamundi"], propertyType: "casa" });
    const c = result.candidates.find((c) => c.domain === "newsite.com");
    expect(c).toBeDefined();
    expect(c!.recon).toBeUndefined();
    expect(result.errors.some((e) => e.includes("recon failed") || e.includes("newsite.com"))).toBe(true);
  });

  it("returns empty candidates/errors when every query returns nothing", async () => {
    mockSerp.mockResolvedValue([]);
    const result = await runDiscovery({ cities: ["jamundi"], propertyType: "casa" });
    expect(result.candidates).toEqual([]);
    expect(result.errors).toEqual([]);
  });
});

describe("runDiscovery — classification", () => {
  it("classifies an already-implemented domain without calling recon on it", async () => {
    mockSerp.mockImplementation(async (query: string) =>
      query.startsWith("portales de arriendo") ? [serpResult("https://www.bienco.com.co/aviso/1")] : [],
    );

    const result = await runDiscovery({ cities: ["jamundi"], propertyType: "casa" });
    const c = result.candidates.find((c) => c.domain === "bienco.com.co");
    expect(c?.status).toBe("known_implemented");
    expect(c?.recon).toBeUndefined();
    expect(mockRecon).not.toHaveBeenCalledWith("bienco.com.co", expect.anything());
  });

  it("classifies an excluded domain with its reason, no recon", async () => {
    mockSerp.mockImplementation(async (query: string) =>
      query.startsWith("portales de arriendo") ? [serpResult("https://mercadolibre.com.co/x")] : [],
    );
    const result = await runDiscovery({ cities: ["jamundi"], propertyType: "casa" });
    const c = result.candidates.find((c) => c.domain === "mercadolibre.com.co");
    expect(c?.status).toBe("known_excluded");
    expect(c?.knownReason).toMatch(/robots\.txt/i);
  });

  it("recons a genuinely new domain and attaches the result", async () => {
    mockSerp.mockImplementation(async (query: string) =>
      query.startsWith("portales de arriendo") ? [serpResult("https://novisimo.com/x")] : [],
    );
    const result = await runDiscovery({ cities: ["jamundi"], propertyType: "casa" });
    const c = result.candidates.find((c) => c.domain === "novisimo.com");
    expect(c?.status).toBe("new");
    expect(c?.recon?.reachable).toBe(true);
  });
});

describe("runDiscovery — maxCandidates cap applies after classification", () => {
  it("caps recon to maxCandidates 'new' domains, excluding known/blocklisted from the count", async () => {
    mockSerp.mockImplementation(async (query: string) => {
      if (!query.startsWith("portales de arriendo")) return [];
      return [
        serpResult("https://bienco.com.co/x"), // known_implemented
        serpResult("https://mercadolibre.com.co/x"), // known_excluded
        serpResult("https://facebook.com/x"), // blocklisted
        serpResult("https://new-one.com/x"),
        serpResult("https://new-two.com/x"),
        serpResult("https://new-three.com/x"),
      ];
    });

    const result = await runDiscovery({ cities: ["jamundi"], propertyType: "casa", maxCandidates: 2 });
    const newOnes = result.candidates.filter((c) => c.status === "new");
    expect(newOnes).toHaveLength(3); // all 3 are still listed...
    const reconned = newOnes.filter((c) => c.recon != null);
    expect(reconned).toHaveLength(2); // ...but only 2 got reconned
    expect(mockRecon).toHaveBeenCalledTimes(2);
  });

  it("prefers higher mentionCount candidates when capping", async () => {
    mockSerp.mockImplementation(async (query: string) => {
      // "popular.com" appears in 2 queries, "rare.com" only in 1
      if (query.startsWith("arriendo casas")) return [serpResult("https://popular.com/1")];
      if (query.includes("inmobiliaria")) return [serpResult("https://popular.com/2")];
      if (query.startsWith("portales de arriendo")) return [serpResult("https://rare.com/1")];
      return [];
    });

    const result = await runDiscovery({ cities: ["jamundi"], propertyType: "casa", maxCandidates: 1 });
    const popular = result.candidates.find((c) => c.domain === "popular.com");
    const rare = result.candidates.find((c) => c.domain === "rare.com");
    expect(popular?.recon).toBeDefined();
    expect(rare?.recon).toBeUndefined();
  });
});

describe("runDiscovery — foreign-country filtering", () => {
  it("excludes a foreign-TLD domain before recon: no slot consumed, listed as foreign", async () => {
    mockSerp.mockImplementation(async (query: string) => {
      if (!query.startsWith("portales de arriendo")) return [];
      return [serpResult("https://chileno.cl/x"), serpResult("https://novato.com/x")];
    });

    const result = await runDiscovery({ cities: ["jamundi"], propertyType: "casa", maxCandidates: 1 });
    const cl = result.candidates.find((c) => c.domain === "chileno.cl");
    expect(cl?.status).toBe("foreign");
    expect(cl?.knownReason).toMatch(/TLD \.cl/);
    expect(cl?.recon).toBeUndefined(); // never reconned -> never consumed the single slot
    expect(mockRecon).not.toHaveBeenCalledWith("chileno.cl", expect.anything());
    expect(mockRecon).toHaveBeenCalledTimes(1); // the slot went to novato.com
    expect(result.candidates.find((c) => c.domain === "novato.com")?.status).toBe("new");
  });

  it("flips a content-verdict foreign candidate after recon (slot consumed, still listed)", async () => {
    mockSerp.mockImplementation(async (query: string) =>
      query.startsWith("portales de arriendo") ? [serpResult("https://guadalajara-renta.com/x")] : [],
    );
    mockRecon.mockImplementation(async () => ({
      reachable: true,
      statusCode: 200,
      robots: { fetched: false, aiBlocked: false, blockedAgents: [] },
      antiBot: { hinted: false, signals: [] },
      relevance: 0.4,
      hasJsonLd: false,
      country: {
        verdict: "foreign",
        evidence: ['moneda extranjera: "$18,000 mxn"', "topónimo: \"guadalajara\""],
      },
    }));

    const result = await runDiscovery({ cities: ["jamundi"], propertyType: "casa" });
    const c = result.candidates.find((c) => c.domain === "guadalajara-renta.com");
    expect(c?.status).toBe("foreign");
    expect(c?.knownReason).toMatch(/fuera de Colombia/);
    expect(c?.knownReason).toContain("guadalajara");
    expect(c?.recon).toBeDefined(); // it DID consume the recon slot — accepted tradeoff, no backfill
    expect(result.candidates.filter((x) => x.status === "new")).toHaveLength(0);
  });

  it("a co or unknown verdict leaves the candidate as new", async () => {
    mockSerp.mockImplementation(async (query: string) => {
      if (!query.startsWith("portales de arriendo")) return [];
      return [serpResult("https://cachaco.com/x"), serpResult("https://dudoso.com/x")];
    });
    mockRecon.mockImplementation(async (domain: string) => ({
      reachable: true,
      statusCode: 200,
      robots: { fetched: false, aiBlocked: false, blockedAgents: [] },
      antiBot: { hinted: false, signals: [] },
      relevance: 0.5,
      hasJsonLd: false,
      country:
        domain === "cachaco.com"
          ? { verdict: "co", evidence: ["señal CO: estrato"] }
          : { verdict: "unknown", evidence: [] },
    }));

    const result = await runDiscovery({ cities: ["jamundi"], propertyType: "casa" });
    expect(result.candidates.find((c) => c.domain === "cachaco.com")?.status).toBe("new");
    expect(result.candidates.find((c) => c.domain === "dudoso.com")?.status).toBe("new");
  });
});
