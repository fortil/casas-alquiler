import type { Listing, ResolvedCrawlParams } from "@/lib/core/schema";

export interface AdapterContext {
  log: (msg: string) => void;
  signal?: AbortSignal;
}

/**
 * Every source implements this. The orchestrator/UI never knows site specifics:
 * `fetchList` paginates internally and yields already-normalized listings.
 */
export interface SourceAdapter {
  id: string;
  label: string;
  tier: "A" | "B" | "C";
  /** Root domain this adapter scrapes (e.g. "bienco.com.co"). Used for site-discovery dedup. */
  domain: string;
  /** True when the adapter cannot work without Bright Data (Tier C). */
  requiresBrightData?: boolean;
  /** Yield normalized listings for the given params (rentals by city). */
  fetchList(params: ResolvedCrawlParams, ctx: AdapterContext): AsyncIterable<Listing>;
  /** Optional: enrich/verify a single listing by URL (e.g. recover phone). */
  fetchDetail?(url: string, ctx: AdapterContext): Promise<Partial<Listing> | null>;
}
