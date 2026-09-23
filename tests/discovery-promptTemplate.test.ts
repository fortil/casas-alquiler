import { describe, it, expect } from "vitest";
import { buildAdapterPrompt } from "@/lib/core/discovery/promptTemplate";
import type { CandidateSource } from "@/lib/core/discovery/pipeline";

function candidate(over: Partial<CandidateSource> & { domain: string }): CandidateSource {
  return {
    status: "new",
    foundVia: [],
    mentionCount: 1,
    discoveredAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

describe("buildAdapterPrompt", () => {
  it("includes the domain and a registration instruction with it", () => {
    const prompt = buildAdapterPrompt(candidate({ domain: "nuevoportal.com" }));
    expect(prompt).toContain("nuevoportal.com");
    expect(prompt).toMatch(/domain: "nuevoportal\.com"/);
  });

  it("summarizes recon findings when present", () => {
    const c = candidate({
      domain: "site.com",
      recon: {
        reachable: true,
        statusCode: 200,
        robots: { fetched: true, aiBlocked: false, blockedAgents: [] },
        antiBot: { hinted: true, signals: ["Cloudflare (cf-ray)"] },
        relevance: 0.82,
        hasJsonLd: true,
        country: { verdict: "unknown", evidence: [] },
      },
    });
    const prompt = buildAdapterPrompt(c);
    expect(prompt).toMatch(/Alcanzable: sí/);
    expect(prompt).toMatch(/HTTP 200/);
    expect(prompt).toMatch(/sin bloqueo a IA/);
    expect(prompt).toMatch(/Cloudflare \(cf-ray\)/);
    expect(prompt).toMatch(/JSON-LD presente: sí/);
    expect(prompt).toMatch(/0\.82/);
    expect(prompt).toMatch(/País: indeterminado/);
  });

  it("carries a foreign verdict with its evidence, marked as do-not-build", () => {
    const c = candidate({
      domain: "chileno.cl",
      recon: {
        reachable: true,
        statusCode: 200,
        robots: { fetched: false, aiBlocked: false, blockedAgents: [] },
        antiBot: { hinted: false, signals: [] },
        relevance: 0.44,
        hasJsonLd: false,
        country: {
          verdict: "foreign",
          evidence: ['moneda extranjera: "uf 3.500"', "topónimo: \"las condes\""],
        },
      },
    });
    const prompt = buildAdapterPrompt(c);
    expect(prompt).toMatch(/País: FUERA de Colombia/);
    expect(prompt).toMatch(/NO construir/);
    expect(prompt).toContain("las condes");
  });

  it("carries a co verdict with its signals", () => {
    const c = candidate({
      domain: "rolo.com",
      recon: {
        reachable: true,
        statusCode: 200,
        robots: { fetched: false, aiBlocked: false, blockedAgents: [] },
        antiBot: { hinted: false, signals: [] },
        relevance: 0.7,
        hasJsonLd: false,
        country: { verdict: "co", evidence: ["señal CO: estrato", "señal CO: NIT"] },
      },
    });
    const prompt = buildAdapterPrompt(c);
    expect(prompt).toMatch(/País: Colombia \(señal CO: estrato; señal CO: NIT\)/);
  });

  it("flags an AI-blocked robots.txt clearly", () => {
    const c = candidate({
      domain: "blocked.com",
      recon: {
        reachable: true,
        statusCode: 200,
        robots: { fetched: true, aiBlocked: true, blockedAgents: ["claudebot"] },
        antiBot: { hinted: false, signals: [] },
        relevance: 0.5,
        hasJsonLd: false,
        country: { verdict: "unknown", evidence: [] },
      },
    });
    const prompt = buildAdapterPrompt(c);
    expect(prompt).toMatch(/BLOQUEA crawlers de IA/);
    expect(prompt).toContain("claudebot");
  });

  it("handles a missing recon gracefully with a clear fallback note", () => {
    const prompt = buildAdapterPrompt(candidate({ domain: "sin-recon.com" }));
    expect(prompt).toMatch(/no verificado/);
    expect(() => buildAdapterPrompt(candidate({ domain: "sin-recon.com" }))).not.toThrow();
  });

  it("does not crash on a recon persisted before recon.country existed", () => {
    const staleRecon = {
      reachable: true,
      statusCode: 200,
      robots: { fetched: false, aiBlocked: false, blockedAgents: [] },
      antiBot: { hinted: false, signals: [] },
      relevance: 0.4,
      hasJsonLd: false,
    } as unknown as CandidateSource["recon"];
    const prompt = buildAdapterPrompt(candidate({ domain: "viejo.com", recon: staleRecon }));
    expect(prompt).toMatch(/País: indeterminado/);
  });

  it("lists the distinct queries that surfaced the candidate", () => {
    const c = candidate({
      domain: "site.com",
      foundVia: [
        { query: "arriendo casas jamundi", url: "https://site.com/a", title: "", engine: "google" },
        { query: "arriendo casas jamundi", url: "https://site.com/b", title: "", engine: "google" },
        { query: "inmobiliaria cali", url: "https://site.com/c", title: "", engine: "google" },
      ],
    });
    const prompt = buildAdapterPrompt(c);
    expect(prompt).toMatch(/arriendo casas jamundi/);
    expect(prompt).toMatch(/inmobiliaria cali/);
    // deduped: the query should not appear twice separated by "; "
    expect(prompt.match(/arriendo casas jamundi/g)?.length).toBe(1);
  });

  it("does not break formatting for a long domain with unusual characters", () => {
    const longDomain = "sub.domain-with-dashes.example.co.uk";
    expect(() => buildAdapterPrompt(candidate({ domain: longDomain }))).not.toThrow();
    const prompt = buildAdapterPrompt(candidate({ domain: longDomain }));
    expect(prompt).toContain(longDomain);
  });

  it("always includes the SourceAdapter contract instructions", () => {
    const prompt = buildAdapterPrompt(candidate({ domain: "x.com" }));
    expect(prompt).toContain("SourceAdapter");
    expect(prompt).toContain("lib/adapters/types.ts");
    expect(prompt).toContain("ALL_ADAPTERS");
  });
});
