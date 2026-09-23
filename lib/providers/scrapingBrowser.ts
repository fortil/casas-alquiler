/**
 * Bright Data Scraping Browser egress.
 *
 * The account's UNLOCKER_ZONE is actually a Scraping Browser zone, so the Web
 * Unlocker request API returns empty bodies (see session notes). The egress
 * that works is the remote Chromium over CDP (BRIGHTDATA_BROWSER_WS): we run fetch()
 * inside the remote page via page.evaluate, so requests leave with Bright
 * Data's Colombian IP and a real Chrome UA/fingerprint.
 *
 * One shared context per process keeps cookies warm across requests (like the
 * CookieJar in HttpClient); a new page is opened per request so concurrent
 * calls never share a navigation target.
 */

import type { Browser, BrowserContext } from "playwright";

export function hasScrapingBrowser(): boolean {
  return !!(process.env.BRIGHTDATA_BROWSER_WS ?? process.env.BROWSER_WS);
}

function browserWs(): string {
  return (process.env.BRIGHTDATA_BROWSER_WS ?? process.env.BROWSER_WS) as string;
}

let browserPromise: Promise<Browser> | null = null;
let contextPromise: Promise<BrowserContext> | null = null;

async function getContext(): Promise<BrowserContext> {
  if (!contextPromise) {
    contextPromise = (async () => {
      if (!browserPromise) {
        // Lazy runtime import keeps playwright out of the server bundle until
        // this egress is actually used.
        browserPromise = (async () => {
          const { chromium } = await import("playwright");
          return chromium.connectOverCDP(browserWs(), {
            timeout: 30_000,
          });
        })();
        // Allow a later call to retry after a failed connection.
        browserPromise.catch(() => {
          browserPromise = null;
        });
      }
      const browser = await browserPromise;
      // Over CDP we must reuse an existing context rather than create one.
      return browser.contexts()[0] ?? (await browser.newContext());
    })();
    contextPromise.catch(() => {
      contextPromise = null;
    });
  }
  return contextPromise;
}

/** Disconnect the CDP session (the remote browser itself stays on Bright Data). */
export async function closeScrapingBrowser(): Promise<void> {
  const bp = browserPromise;
  browserPromise = null;
  contextPromise = null;
  if (!bp) return;
  try {
    (await bp).close();
  } catch {
    /* already gone */
  }
}

/**
 * Fetch a URL from inside the remote browser. Returns null on any failure
 * (no BRIGHTDATA_BROWSER_WS, connect error, non-2xx, timeout) so callers can
 * fall back.
 */
export async function browserEgressFetch(
  url: string,
  opts: { headers?: Record<string, string>; timeoutMs?: number } = {},
): Promise<string | null> {
  if (!hasScrapingBrowser()) return null;
  const timeoutMs = opts.timeoutMs ?? 45_000;
  try {
    const context = await getContext();
    const page = await context.newPage();
    try {
      // Forbidden headers (User-Agent etc.) are ignored by in-page fetch; the
      // remote Chrome supplies its own, which is exactly what we want.
      const body = await Promise.race([
        page.evaluate(
          ({ u, h }) =>
            fetch(u, { headers: h, redirect: "follow" })
              .then((r) => (r.ok ? r.text() : null))
              .catch(() => null),
          { u: url, h: opts.headers ?? {} },
        ),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
      ]);
      return body ?? null;
    } finally {
      await page.close().catch(() => {});
    }
  } catch {
    return null;
  }
}
