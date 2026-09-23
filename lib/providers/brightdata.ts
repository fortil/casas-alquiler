import { BROWSER_HEADERS } from "@/lib/config";

/**
 * Bright Data Web Unlocker wrapper. Used for Tier C sites (Imperva/geo-gating)
 * and as an escalation fallback when a normally-direct site starts blocking.
 * Degrades gracefully: returns null when no key/zone is configured.
 */

export function hasBrightData(): boolean {
  // BRIGHTDATA_BROWSER_WS (Scraping Browser) counts as an available remote
  // egress too — HttpClient routes "brightdata" through it when the Unlocker
  // zone is absent or is actually a Scraping Browser zone.
  return !!(
    (process.env.BRIGHTDATA_API_KEY && process.env.BRIGHTDATA_UNLOCKER_ZONE) ||
    process.env.BRIGHTDATA_BROWSER_WS ||
    process.env.BROWSER_WS
  );
}

export interface BrightDataOptions {
  /** "raw" returns the page body as-is; default raw. */
  format?: "raw" | "json";
  /** ISO country to route through (default "co" for Colombian geo-gating). */
  country?: string;
  timeoutMs?: number;
}

export async function brightDataFetch(
  url: string,
  opts: BrightDataOptions = {},
): Promise<string | null> {
  if (!hasBrightData()) return null;
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), opts.timeoutMs ?? 45000);
  try {
    const res = await fetch("https://api.brightdata.com/request", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.BRIGHTDATA_API_KEY}`,
      },
      body: JSON.stringify({
        zone: process.env.BRIGHTDATA_UNLOCKER_ZONE,
        url,
        format: opts.format ?? "raw",
        country: opts.country ?? "co",
        // Pass through a realistic UA/locale so we get the es-CO version.
        headers: BROWSER_HEADERS,
      }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}
