import { describe, it, expect } from "vitest";
import { analyzeRobotsTxt, detectAntiBotHints, relevanceScore, detectCountry } from "@/lib/core/discovery/recon";

describe("analyzeRobotsTxt — AI-crawler full-site bans", () => {
  it("detects a ClaudeBot full-site ban", () => {
    const r = analyzeRobotsTxt("User-agent: ClaudeBot\nDisallow: /");
    expect(r.fetched).toBe(true);
    expect(r.aiBlocked).toBe(true);
    expect(r.blockedAgents).toContain("claudebot");
  });

  it("detects anthropic-ai, GPTBot, CCBot, and wildcard bans", () => {
    expect(analyzeRobotsTxt("User-agent: anthropic-ai\nDisallow: /").aiBlocked).toBe(true);
    expect(analyzeRobotsTxt("User-agent: GPTBot\nDisallow: /").aiBlocked).toBe(true);
    expect(analyzeRobotsTxt("User-agent: CCBot\nDisallow: /").aiBlocked).toBe(true);
    expect(analyzeRobotsTxt("User-agent: *\nDisallow: /").aiBlocked).toBe(true);
  });

  it("is case-insensitive on the agent name", () => {
    expect(analyzeRobotsTxt("User-agent: Claudebot\nDisallow: /").aiBlocked).toBe(true);
  });

  it("does NOT flag a partial-path disallow", () => {
    const r = analyzeRobotsTxt("User-agent: ClaudeBot\nDisallow: /privado/");
    expect(r.aiBlocked).toBe(false);
  });

  it("does NOT flag a full ban on a non-AI agent", () => {
    const r = analyzeRobotsTxt("User-agent: SomeOtherBot\nDisallow: /");
    expect(r.aiBlocked).toBe(false);
  });

  it("handles multiple User-agent lines sharing one Disallow block", () => {
    const r = analyzeRobotsTxt("User-agent: GPTBot\nUser-agent: ClaudeBot\nDisallow: /");
    expect(r.blockedAgents.sort()).toEqual(["claudebot", "gptbot"]);
  });

  it("does not leak a ban across separate blocks", () => {
    const r = analyzeRobotsTxt(
      "User-agent: GoodBot\nDisallow: /admin/\n\nUser-agent: ClaudeBot\nAllow: /",
    );
    expect(r.aiBlocked).toBe(false);
  });

  it("ignores comments and blank lines", () => {
    const r = analyzeRobotsTxt("# comment\n\nUser-agent: ClaudeBot\n# another comment\nDisallow: /");
    expect(r.aiBlocked).toBe(true);
  });

  it("returns fetched:false for null or empty input (no robots.txt found)", () => {
    expect(analyzeRobotsTxt(null)).toEqual({ fetched: false, aiBlocked: false, blockedAgents: [] });
    expect(analyzeRobotsTxt("")).toEqual({ fetched: false, aiBlocked: false, blockedAgents: [] });
    expect(analyzeRobotsTxt("   ")).toEqual({ fetched: false, aiBlocked: false, blockedAgents: [] });
  });

  it("dedupes repeated agent bans", () => {
    const r = analyzeRobotsTxt(
      "User-agent: ClaudeBot\nDisallow: /\n\nUser-agent: ClaudeBot\nDisallow: /",
    );
    expect(r.blockedAgents).toEqual(["claudebot"]);
  });

  it("tolerates a real-world multi-section robots.txt with an unrelated ban", () => {
    const txt = [
      "User-agent: *",
      "Disallow: /wp-admin/",
      "",
      "User-agent: AhrefsBot",
      "Disallow: /",
      "",
      "Sitemap: https://example.com/sitemap.xml",
    ].join("\n");
    const r = analyzeRobotsTxt(txt);
    expect(r.fetched).toBe(true);
    expect(r.aiBlocked).toBe(false); // AhrefsBot isn't an AI-crawler name we track
  });
});

describe("detectAntiBotHints", () => {
  it("flags cf-ray header presence", () => {
    const h = detectAntiBotHints({ "cf-ray": "abc123" }, "");
    expect(h.hinted).toBe(true);
    expect(h.signals).toContain("Cloudflare (cf-ray)");
  });

  it("flags an Incapsula server header", () => {
    const h = detectAntiBotHints({ server: "Incapsula" }, "");
    expect(h.hinted).toBe(true);
  });

  it("flags a Cloudflare challenge body without any header", () => {
    const h = detectAntiBotHints({}, "<html>Checking your browser before accessing...</html>");
    expect(h.hinted).toBe(true);
    expect(h.signals.some((s) => /browser-check/i.test(s))).toBe(true);
  });

  it("flags a captcha mention", () => {
    const h = detectAntiBotHints({}, "please complete the CAPTCHA to continue");
    expect(h.hinted).toBe(true);
  });

  it("returns hinted:false with no signals for a plain response", () => {
    const h = detectAntiBotHints({ "content-type": "text/html" }, "<html>Bienvenido</html>");
    expect(h.hinted).toBe(false);
    expect(h.signals).toEqual([]);
  });

  it("headers are matched case-insensitively", () => {
    const h = detectAntiBotHints({ "CF-Ray": "xyz" }, "");
    expect(h.hinted).toBe(true);
  });

  it("dedupes repeated signals", () => {
    const h = detectAntiBotHints(
      { "cf-ray": "x", server: "cloudflare" },
      "just a moment...",
    );
    expect(new Set(h.signals).size).toBe(h.signals.length);
  });
});

describe("relevanceScore", () => {
  it("scores near 0 for a page with no rental/city keywords", () => {
    const score = relevanceScore("<html><body>Bienvenido a mi blog de cocina</body></html>", ["Jamundí", "Cali"]);
    expect(score).toBeLessThan(0.1);
  });

  it("scores higher for a keyword-dense rental homepage", () => {
    const html =
      "Arriendo casas en Jamundí. Inmobiliaria Jamundí arriendo apartamentos. Alquiler de casas en Cali. Arriendo Cali.";
    const score = relevanceScore(html, ["Jamundí", "Cali"]);
    expect(score).toBeGreaterThan(0.3);
  });

  it("is bounded to [0,1] even for extremely dense keyword stuffing", () => {
    const html = Array(50).fill("arriendo arriendo jamundi cali inmobiliaria").join(" ");
    const score = relevanceScore(html, ["Jamundí", "Cali"]);
    expect(score).toBeLessThanOrEqual(1);
    expect(score).toBeGreaterThan(0);
  });

  it("returns 0 for empty or near-empty HTML", () => {
    expect(relevanceScore("", ["Jamundí"])).toBe(0);
    expect(relevanceScore("hi", ["Jamundí"])).toBe(0);
  });

  it("is accent/case-insensitive on city names", () => {
    const score = relevanceScore("ARRIENDO en JAMUNDI y en jamúndi", ["Jamundí"]);
    expect(score).toBeGreaterThan(0);
  });

  it("handles an empty cities array without throwing", () => {
    expect(() => relevanceScore("arriendo casas", [])).not.toThrow();
  });

  it("does not crash on regex-special characters in a city name", () => {
    expect(() => relevanceScore("some html", ["Ci(u)dad+Especial"])).not.toThrow();
  });

  it("'calidad' and 'localidad' do NOT count as Cali mentions", () => {
    const score = relevanceScore(
      "La calidad del inmueble y su localidad son excelentes para vivir con la familia",
      ["Cali"],
    );
    expect(score).toBe(0);
  });

  it("a real 'Cali' word still counts", () => {
    const score = relevanceScore("arriendo de apartamentos en Cali, zona sur", ["Cali"]);
    expect(score).toBeGreaterThan(0);
  });
});

describe("detectCountry", () => {
  it("two concordant signals (amount+currency and toponym) give foreign", () => {
    const html =
      "Renta de departamentos amueblados en Guadalajara, Jalisco. Desde $18,000 MXN al mes.";
    const v = detectCountry(html);
    expect(v.verdict).toBe("foreign");
    expect(v.evidence.some((e) => /mxn/i.test(e))).toBe(true);
    expect(v.evidence.some((e) => e.includes("guadalajara") || e.includes("jalisco"))).toBe(true);
  });

  it("a country-selector phone widget alone does NOT give foreign", () => {
    const widget =
      "Selecciona país: México (+52) Andorra (+376) Emiratos Árabes Unidos (+971) Colombia (+57) Chile (+56)";
    expect(detectCountry(widget).verdict).toBe("unknown");
  });

  it("a shopping-cart currency-code list alone does NOT give foreign", () => {
    const cart = 'Cambia la moneda: "ALL", "USD", "MXN", "CLP", "COP", "ARS", "PEN", "EUR"';
    expect(detectCountry(cart).verdict).toBe("unknown");
  });

  it("estrato and NIT give co", () => {
    const v = detectCountry(
      "Apartamento estrato 4 en arriendo, NIT 900.123.456, canon de arrendamiento $1.500.000",
    );
    expect(v.verdict).toBe("co");
    expect(v.evidence.some((e) => e.includes("estrato"))).toBe(true);
  });

  it("a real +57 phone number gives co; the bare widget entry does not", () => {
    expect(detectCountry("Llámenos al +57 300 123 4567 de 8am a 6pm").verdict).toBe("co");
    expect(detectCountry("Elige tu país: Colombia (+57) o Chile (+56)").verdict).toBe("unknown");
  });

  it("'Santiago de Cali' is not a foreign toponym", () => {
    const v = detectCountry("Arriendos en Santiago de Cali, estrato 3, cerca del sur");
    expect(v.verdict).toBe("co");
  });

  it("a single stray foreign signal stays unknown (two required)", () => {
    expect(detectCountry("Departamentos en Guadalajara en renta").verdict).toBe("unknown");
    expect(detectCountry("Precio del alquiler: S/ 800 mensuales").verdict).toBe("unknown");
  });

  it("toponyms from DIFFERENT countries stay unknown — aggregator signature", () => {
    // Seen live on apartamento.com.co: a Colombian portal whose home lists
    // international inventory ("Guadalajara" MX + "Santiago" CL).
    const v = detectCountry("Arriendos y rentas: Guadalajara, Santiago, Buenos Aires");
    expect(v.verdict).toBe("unknown");
  });

  it("Colombian signals alongside foreign ones mean mixed -> unknown", () => {
    const v = detectCountry("Estrato 4, NIT 900.123.456. También rentas en Guadalajara desde $18,000 MXN");
    expect(v.verdict).toBe("unknown");
  });

  it("two signals from the SAME foreign country give foreign", () => {
    const v = detectCountry("Renta en Las Condes, Santiago. Canon UF 3.500 mensual.");
    expect(v.verdict).toBe("foreign");
  });

  it("empty HTML gives unknown with no evidence", () => {
    expect(detectCountry("")).toEqual({ verdict: "unknown", evidence: [] });
  });
});
