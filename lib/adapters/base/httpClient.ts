import makeFetchCookie from "fetch-cookie";
import { CookieJar } from "tough-cookie";
import { BROWSER_HEADERS, REQUEST_DELAY_MS } from "@/lib/config";
import { brightDataFetch, hasBrightData } from "@/lib/providers/brightdata";
import { browserEgressFetch, hasScrapingBrowser } from "@/lib/providers/scrapingBrowser";

export type FetchVia = "direct" | "brightdata" | "auto";

let forcedVia: FetchVia | null = null;

/**
 * Route every getText/getJson through a given egress regardless of per-request
 * opts — used to crawl with Bright Data's remote IP when the local one is
 * banned. The orchestrator sets it for a whole crawl and clears it in a
 * finally. Crawls run sequentially in this app, so a module-level switch is
 * safe.
 */
export function setForcedFetchVia(via: FetchVia | null): void {
  forcedVia = via;
}

/**
 * Remote-egress chain: Scraping Browser (BRIGHTDATA_BROWSER_WS) first — the
 * account's Unlocker zone is a Scraping Browser zone and returns empty bodies
 * via the request API — then the Web Unlocker API as fallback.
 */
async function remoteEgressFetch(url: string, opts: GetOptions): Promise<string | null> {
  const headers = { ...BROWSER_HEADERS, ...opts.headers };
  if (hasScrapingBrowser()) {
    const body = await browserEgressFetch(url, { headers, timeoutMs: opts.timeoutMs });
    if (body != null) return body;
  }
  return brightDataFetch(url, { timeoutMs: opts.timeoutMs });
}

export interface GetOptions {
  via?: FetchVia;
  headers?: Record<string, string>;
  delayMs?: number;
  /** Abort the direct fetch after this many ms. Undefined = no timeout (default, unchanged behavior). */
  timeoutMs?: number;
}

export interface RawResponse {
  ok: boolean;
  status: number | null;
  headers: Record<string, string>;
  body: string | null;
  error?: string;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Polite, cookie-aware HTTP client for adapters.
 *  - Persists cookies across requests (e.g. Cloudflare __cf_bm).
 *  - Throttles to ~1 req/s per client (one client per adapter/host).
 *  - "auto" falls back to Bright Data when a direct request is blocked.
 */
export class HttpClient {
  private jar = new CookieJar();
  private fetchImpl: typeof fetch;
  private lastReqAt = 0;

  constructor(private defaultDelayMs = REQUEST_DELAY_MS) {
    this.fetchImpl = makeFetchCookie(fetch, this.jar) as unknown as typeof fetch;
  }

  private async throttle(delayMs: number) {
    const wait = this.lastReqAt + delayMs - Date.now();
    if (wait > 0) await sleep(wait);
    this.lastReqAt = Date.now();
  }

  /** Fetch a URL as text. Throws if neither direct nor fallback succeed. */
  async getText(url: string, opts: GetOptions = {}): Promise<string> {
    const via = forcedVia ?? opts.via ?? "direct";
    const headers = { ...BROWSER_HEADERS, ...opts.headers };

    if (via === "brightdata") {
      // Throttle the remote egress too — same politeness as direct requests.
      await this.throttle(opts.delayMs ?? this.defaultDelayMs);
      const body = await remoteEgressFetch(url, opts);
      if (body == null) throw new Error(`brightdata fetch failed: ${url}`);
      return body;
    }

    await this.throttle(opts.delayMs ?? this.defaultDelayMs);
    let res: Response | null = null;
    try {
      res = await this.fetchImpl(url, this.fetchInit(headers, opts.timeoutMs));
      if (res.ok) return await res.text();
    } catch {
      res = null;
    }

    if (via === "auto" && hasBrightData()) {
      const body = await remoteEgressFetch(url, opts);
      if (body != null) return body;
    }
    throw new Error(`GET failed (${res?.status ?? "network"}): ${url}`);
  }

  /** Fetch and parse JSON. */
  async getJson<T>(url: string, opts: GetOptions = {}): Promise<T> {
    const headers = {
      ...BROWSER_HEADERS,
      Accept: "application/json, text/plain, */*",
      ...opts.headers,
    };
    const text = await this.getText(url, { ...opts, headers });
    return JSON.parse(text) as T;
  }

  /**
   * Fetch a URL directly (no Bright Data fallback), never throwing — returns
   * status/headers/body regardless of HTTP status, or `{ok:false, error}` on a
   * network failure/timeout. Used by lightweight recon, which needs to inspect
   * non-2xx responses rather than treat them as fatal.
   */
  async getRaw(url: string, opts: GetOptions = {}): Promise<RawResponse> {
    const headers = { ...BROWSER_HEADERS, ...opts.headers };
    await this.throttle(opts.delayMs ?? this.defaultDelayMs);
    try {
      const res = await this.fetchImpl(url, this.fetchInit(headers, opts.timeoutMs));
      const body = await res.text();
      const hdrs: Record<string, string> = {};
      res.headers.forEach((v, k) => (hdrs[k.toLowerCase()] = v));
      return { ok: res.ok, status: res.status, headers: hdrs, body };
    } catch (e) {
      return { ok: false, status: null, headers: {}, body: null, error: (e as Error).message };
    }
  }

  private fetchInit(headers: Record<string, string>, timeoutMs?: number): RequestInit {
    return {
      headers,
      redirect: "follow",
      signal: timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined,
    };
  }
}
