import { describe, it, expect } from "vitest";
import {
  rootDomain,
  classifyDomain,
  dedupeByDomain,
  EXCLUDED_DOMAINS,
  NON_PORTAL_BLOCKLIST,
} from "@/lib/core/discovery/domainFilter";

const ADAPTER_DOMAINS = [
  "bienco.com.co",
  "fincaraiz.com.co",
  "ciencuadras.com",
  "properati.com.co",
  "rentola.co.com",
  "inmobiliariajr.com.co",
  "inmoalfaguara.co",
  "casas.mitula.com.co",
  "metrocuadrado.com",
];

describe("rootDomain", () => {
  it("strips scheme, www, path, query and fragment", () => {
    expect(rootDomain("https://www.example.com/arriendo?x=1#y")).toBe("example.com");
    expect(rootDomain("http://example.com")).toBe("example.com");
  });

  it("strips a non-default port", () => {
    expect(rootDomain("https://example.com:8080/x")).toBe("example.com");
  });

  it("preserves a real subdomain that is not 'www'", () => {
    expect(rootDomain("https://casas.mitula.com.co/x")).toBe("casas.mitula.com.co");
    expect(rootDomain("https://m.facebook.com/x")).toBe("m.facebook.com");
  });

  it("does not conflate .com.co, .co, and .com", () => {
    expect(rootDomain("https://inmoalfaguara.co")).toBe("inmoalfaguara.co");
    expect(rootDomain("https://ciencuadras.com")).toBe("ciencuadras.com");
    expect(rootDomain("https://fincaraiz.com.co")).toBe("fincaraiz.com.co");
  });

  it("is case-insensitive on the hostname", () => {
    expect(rootDomain("https://WWW.Example.COM/x")).toBe("example.com");
  });

  it("returns null for unparseable input", () => {
    expect(rootDomain("not a url")).toBeNull();
    expect(rootDomain("")).toBeNull();
    expect(rootDomain("://missing-scheme")).toBeNull();
  });
});

describe("classifyDomain — known_implemented (exact match, all 9 adapters)", () => {
  it.each(ADAPTER_DOMAINS)("%s classifies as known_implemented", (d) => {
    expect(classifyDomain(d, ADAPTER_DOMAINS)).toEqual({ reason: "known_implemented" });
  });

  it("matches case-insensitively", () => {
    expect(classifyDomain("BIENCO.COM.CO", ADAPTER_DOMAINS)?.reason).toBe("known_implemented");
  });

  it("matches a subdomain of an implemented domain", () => {
    expect(classifyDomain("www.bienco.com.co", ADAPTER_DOMAINS)?.reason).toBe("known_implemented");
    expect(classifyDomain("blog.ciencuadras.com", ADAPTER_DOMAINS)?.reason).toBe("known_implemented");
  });

  it("does not false-positive on a domain that merely contains the substring", () => {
    // "notbienco.com.co" must NOT match "bienco.com.co"
    expect(classifyDomain("notbienco.com.co", ADAPTER_DOMAINS)).toBeNull();
  });
});

describe("classifyDomain — known_excluded (all 5, with reasons)", () => {
  it.each(Object.entries(EXCLUDED_DOMAINS))("%s classifies as known_excluded with a reason", (d, reason) => {
    const c = classifyDomain(d, ADAPTER_DOMAINS);
    expect(c?.reason).toBe("known_excluded");
    expect(c?.note).toBe(reason);
  });

  it("matches a subdomain of an excluded domain", () => {
    expect(classifyDomain("www.mercadolibre.com.co", ADAPTER_DOMAINS)?.reason).toBe("known_excluded");
  });
});

describe("classifyDomain — blocklisted", () => {
  it.each(NON_PORTAL_BLOCKLIST)("%s classifies as blocklisted", (d) => {
    expect(classifyDomain(d, ADAPTER_DOMAINS)?.reason).toBe("blocklisted");
  });

  it("matches a subdomain of a blocklisted domain", () => {
    expect(classifyDomain("m.facebook.com", ADAPTER_DOMAINS)?.reason).toBe("blocklisted");
    expect(classifyDomain("maps.google.com", ADAPTER_DOMAINS)?.reason).toBe("blocklisted");
  });
});

describe("classifyDomain — novel domain", () => {
  it("returns null for a domain not in any list", () => {
    expect(classifyDomain("unsitiodesconocido.com", ADAPTER_DOMAINS)).toBeNull();
  });

  it("returns null with an empty implemented-domains set", () => {
    expect(classifyDomain("bienco.com.co", [])).toBeNull();
  });
});

describe("classifyDomain — foreign ccTLD (blacklist, not allowlist)", () => {
  it.each([
    ["inmobiliaria.mx", "México"],
    ["hogar.com.mx", "México"], // second-level ccTLD, still ends with ".mx"
    ["portal.cl", "Chile"],
    ["inmo.com.ar", "Argentina"],
    ["casas.com.br", "Brasil"],
    ["pisos.es", "España"],
  ])("%s classifies as foreign with the country in the note", (d, country) => {
    const c = classifyDomain(d, ADAPTER_DOMAINS);
    expect(c?.reason).toBe("foreign");
    expect(c?.note).toContain(country);
  });

  it("subdomains of a foreign-TLD root classify the same", () => {
    expect(classifyDomain("www.portal.cl", ADAPTER_DOMAINS)?.reason).toBe("foreign");
  });

  it("does NOT flag .com, .co or .com.co (Colombian agencies live there too)", () => {
    expect(classifyDomain("inmobiliarianaranjoduque.com", ADAPTER_DOMAINS)).toBeNull();
    expect(classifyDomain("unnuevoportal.com.co", ADAPTER_DOMAINS)).toBeNull();
    expect(classifyDomain("otro.co", ADAPTER_DOMAINS)).toBeNull();
    expect(classifyDomain("rentola.co.com", [])).toBeNull();
  });

  it("an implemented domain always wins over the TLD check", () => {
    expect(classifyDomain("metrocuadrado.com", ADAPTER_DOMAINS)).toEqual({ reason: "known_implemented" });
  });
});

describe("dedupeByDomain", () => {
  it("groups items by root domain and preserves all items", () => {
    const items = [
      { url: "https://a.com/1", q: "q1" },
      { url: "https://www.a.com/2", q: "q2" },
      { url: "https://b.com/1", q: "q3" },
    ];
    const grouped = dedupeByDomain(items);
    expect(grouped.get("a.com")).toHaveLength(2);
    expect(grouped.get("b.com")).toHaveLength(1);
    expect(grouped.size).toBe(2);
  });

  it("merges foundVia-style entries across duplicate-domain hits", () => {
    const items = [
      { url: "https://a.com/x", query: "arriendo casas jamundi" },
      { url: "https://a.com/y", query: "inmobiliaria cali" },
    ];
    const grouped = dedupeByDomain(items);
    const queries = grouped.get("a.com")!.map((i) => i.query);
    expect(queries).toEqual(["arriendo casas jamundi", "inmobiliaria cali"]);
  });

  it("silently drops items with an unparseable url", () => {
    const items = [{ url: "not a url" }, { url: "https://ok.com/x" }];
    const grouped = dedupeByDomain(items);
    expect(grouped.size).toBe(1);
    expect(grouped.has("ok.com")).toBe(true);
  });

  it("returns an empty map for an empty list", () => {
    expect(dedupeByDomain([]).size).toBe(0);
  });
});
