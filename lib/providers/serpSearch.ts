import { BROWSER_HEADERS } from "@/lib/config";

/**
 * Search-engine-results-page (SERP) provider for site discovery. v1 supports
 * Bright Data's SERP product only (reuses BRIGHTDATA_API_KEY, needs a
 * dedicated BRIGHTDATA_SERP_ZONE distinct from the Web Unlocker zone used for
 * Tier C scraping). Never scrapes google.com directly — that would violate
 * Google's ToS and get CAPTCHA'd; Bright Data's SERP zone is the compliant,
 * managed path. Degrades gracefully (returns []) when unconfigured or on any
 * failure — a discovery run should never crash for lack of a search key.
 */

export interface SerpResult {
  url: string;
  title: string;
  snippet: string;
  engine: "google" | "bing" | "yandex";
}

export function hasBrightDataSerp(): boolean {
  return !!(process.env.BRIGHTDATA_API_KEY && process.env.BRIGHTDATA_SERP_ZONE);
}

/** True when at least one SERP provider is usable. */
export function hasSerpProvider(): boolean {
  return hasBrightDataSerp();
}

export function serpProviderStatus(): { brightDataSerp: boolean } {
  return { brightDataSerp: hasBrightDataSerp() };
}

const ENGINE_SEARCH_URL: Record<NonNullable<SerpSearchOptions["engine"]>, string> = {
  google: "https://www.google.com/search",
  bing: "https://www.bing.com/search",
};

export interface SerpSearchOptions {
  engine?: "google" | "bing";
  count?: number;
  timeoutMs?: number;
  /** country code for Google's `gl`/`cr` params (default "co") — geolocates AND restricts the result set */
  country?: string;
  /** language code for Google's `hl` param (default "es") */
  language?: string;
}

interface BrightDataSerpOrganic {
  link?: string;
  title?: string;
  description?: string;
}
interface BrightDataSerpResponse {
  organic?: BrightDataSerpOrganic[];
}

/**
 * Run one search query through the configured SERP provider. Never throws —
 * returns [] when unconfigured, on a network error, or on a malformed
 * response. `count` is a request hint to the provider, not a hard guarantee.
 */
export async function serpSearch(query: string, opts: SerpSearchOptions = {}): Promise<SerpResult[]> {
  const q = query.trim();
  if (!q) return [];
  if (!hasBrightDataSerp()) return [];

  const engine = opts.engine ?? "google";
  const count = opts.count ?? 10;
  const target = new URL(ENGINE_SEARCH_URL[engine]);
  target.searchParams.set("q", q);
  target.searchParams.set("num", String(count));
  target.searchParams.set("brd_json", "1");
  // Country params are Google-only (bing ignores them). `cr` is the one that
  // actually restricts the result set by country; `gl`/`hl` bias it. Note the
  // body's `country: "co"` below only geolocates the proxy exit, it does not
  // filter results — that's why `cr` is needed.
  if (engine === "google") {
    const country = (opts.country ?? "co").toLowerCase();
    const language = (opts.language ?? "es").toLowerCase();
    target.searchParams.set("gl", country);
    target.searchParams.set("hl", language);
    target.searchParams.set("cr", `country${country.toUpperCase()}`);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 20000);
  try {
    const res = await fetch("https://api.brightdata.com/request", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.BRIGHTDATA_API_KEY}`,
      },
      body: JSON.stringify({
        zone: process.env.BRIGHTDATA_SERP_ZONE,
        url: target.toString(),
        format: "raw",
        country: "co",
        headers: BROWSER_HEADERS,
      }),
      signal: controller.signal,
    });
    if (!res.ok) return [];

    const raw = await res.text();
    let parsed: BrightDataSerpResponse;
    try {
      parsed = JSON.parse(raw) as BrightDataSerpResponse;
    } catch {
      return [];
    }
    if (!Array.isArray(parsed.organic)) return [];

    const results: SerpResult[] = [];
    for (const item of parsed.organic) {
      if (!item?.link) continue;
      results.push({
        url: item.link,
        title: item.title ?? "",
        snippet: item.description ?? "",
        engine,
      });
    }
    return results;
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}
