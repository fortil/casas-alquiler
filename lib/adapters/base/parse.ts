import * as cheerio from "cheerio";

export type Cheerio = cheerio.CheerioAPI;

export function load(html: string): Cheerio {
  return cheerio.load(html);
}

/** Parse every <script type="application/ld+json"> block into objects. */
export function extractJsonLd($: Cheerio): unknown[] {
  const out: unknown[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).contents().text();
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) out.push(...parsed);
      else out.push(parsed);
    } catch {
      // some sites concatenate multiple JSON objects; try a lenient split
      for (const piece of raw.split(/}\s*{/)) {
        try {
          out.push(JSON.parse(piece.startsWith("{") ? piece : `{${piece}`));
        } catch {
          /* ignore */
        }
      }
    }
  });
  return out;
}

/** Find the first JSON-LD node whose @type matches (case-insensitive). */
export function findJsonLdByType(nodes: unknown[], ...types: string[]): Record<string, unknown> | null {
  const want = new Set(types.map((t) => t.toLowerCase()));
  const matches = (node: unknown): Record<string, unknown> | null => {
    if (!node || typeof node !== "object") return null;
    const obj = node as Record<string, unknown>;
    const t = obj["@type"];
    const tArr = Array.isArray(t) ? t : [t];
    if (tArr.some((x) => typeof x === "string" && want.has(x.toLowerCase()))) return obj;
    return null;
  };
  for (const n of nodes) {
    const m = matches(n);
    if (m) return m;
    // also look one level into @graph
    if (n && typeof n === "object" && "@graph" in (n as object)) {
      const graph = (n as { "@graph"?: unknown[] })["@graph"];
      if (Array.isArray(graph)) {
        for (const g of graph) {
          const gm = matches(g);
          if (gm) return gm;
        }
      }
    }
  }
  return null;
}

/** Parse the Next.js <script id="__NEXT_DATA__"> blob. */
export function extractNextData<T = unknown>(html: string): T | null {
  const m = html.match(
    /<script[^>]+id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/,
  );
  if (!m) return null;
  try {
    return JSON.parse(m[1]) as T;
  } catch {
    return null;
  }
}

/** Resolve a possibly-relative href against a base URL. */
export function absolutize(base: string, href: string | undefined | null): string | null {
  if (!href) return null;
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

/** Pull <loc> entries out of a sitemap XML. */
export function extractSitemapLocs(xml: string): string[] {
  const out: string[] = [];
  const re = /<loc>\s*([^<]+?)\s*<\/loc>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) out.push(m[1]);
  return out;
}
