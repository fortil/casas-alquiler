import { prisma } from "@/lib/db/client";
import { selectAdapters } from "@/lib/adapters";
import {
  CrawlParamsSchema,
  type CrawlParams,
  type Listing,
} from "@/lib/core/schema";
import { ensureListingGeo } from "@/lib/core/geocode";
import { takeUpTo } from "@/lib/util/asyncLimit";
import { setForcedFetchVia } from "@/lib/adapters/base/httpClient";
import { hasBrightData } from "@/lib/providers/brightdata";
import { closeScrapingBrowser, hasScrapingBrowser } from "@/lib/providers/scrapingBrowser";
import type { AdapterContext } from "@/lib/adapters/types";

export interface CrawlOptions {
  /** geocode listings that lack source coordinates during the crawl */
  geocode?: boolean;
  /**
   * "brightdata" routes every adapter fetch through Bright Data's remote IP
   * (Scraping Browser / Unlocker) instead of the local one — for when the
   * local IP is banned by the portals.
   */
  egress?: "local" | "brightdata";
  onLog?: (msg: string) => void;
  signal?: AbortSignal;
}

export interface CrawlResult {
  runId: string;
  total: number;
  persisted: number;
  bySource: Record<string, number>;
  deactivated: number;
  errors: string[];
  warnings: string[];
  startedAt: string;
  finishedAt: string;
}

/**
 * Run a full crawl: every selected adapter -> normalize -> persist (upsert by
 * source+id) -> mark listings not seen this run as inactive (rented/removed).
 * Dedup is applied at read/scoring time, so each source row is tracked
 * individually for availability.
 */
export async function runCrawl(
  rawParams: CrawlParams,
  opts: CrawlOptions = {},
): Promise<CrawlResult> {
  const wantRemote = opts.egress === "brightdata";
  const remoteAvailable = hasBrightData() || hasScrapingBrowser();
  if (wantRemote && remoteAvailable) setForcedFetchVia("brightdata");
  try {
    const result = await crawlListings(rawParams, opts, wantRemote && remoteAvailable);
    if (wantRemote && !remoteAvailable) {
      result.warnings.push(
        "Bright Data solicitado pero no configurado (BRIGHTDATA_BROWSER_WS o BRIGHTDATA_API_KEY/BRIGHTDATA_UNLOCKER_ZONE en .env); se usó la IP local",
      );
    }
    return result;
  } finally {
    setForcedFetchVia(null);
    await closeScrapingBrowser();
  }
}

async function crawlListings(
  rawParams: CrawlParams,
  opts: CrawlOptions,
  remoteForced: boolean,
): Promise<CrawlResult> {
  const params = CrawlParamsSchema.parse(rawParams);
  const log = (m: string) => {
    opts.onLog?.(m);
  };
  if (remoteForced) log("egress: rastreo con IP remota de Bright Data");
  const startedAt = new Date();

  const run = await prisma.run.create({
    data: { params: JSON.stringify(params), status: "running" },
  });

  const adapters = selectAdapters({ includeHardSources: params.includeHardSources });
  const ctx: AdapterContext = { log, signal: opts.signal };

  const bySource: Record<string, number> = {};
  const errors: string[] = [];
  const warnings: string[] = [];
  const seenBySource: Record<string, Set<string>> = {};
  let total = 0;
  let persisted = 0;

  for (const adapter of adapters) {
    bySource[adapter.id] = 0;
    seenBySource[adapter.id] = new Set();
    log(`▶ ${adapter.id}: starting`);
    try {
      for await (const listing of takeUpTo(adapter.fetchList(params, ctx), params.maxPerSource)) {
        if (opts.signal?.aborted) break;
        total++;
        bySource[adapter.id]++;
        seenBySource[adapter.id].add(listing.sourceListingId);
        try {
          if (opts.geocode) await ensureListingGeo(listing);
          await persistListing(listing);
          persisted++;
        } catch (e) {
          errors.push(`${adapter.id} persist ${listing.sourceListingId}: ${(e as Error).message}`);
        }
      }
      log(`✓ ${adapter.id}: ${bySource[adapter.id]} listings`);
    } catch (e) {
      errors.push(`${adapter.id}: ${(e as Error).message}`);
      log(`✗ ${adapter.id}: ${(e as Error).message}`);
    }
  }

  // Mark listings not seen this run (for the sources we actually crawled) inactive.
  let deactivated = 0;
  for (const adapter of adapters) {
    const seen = Array.from(seenBySource[adapter.id]);
    if (bySource[adapter.id] === 0) continue; // adapter failed entirely; don't nuke its data
    const res = await prisma.listing.updateMany({
      where: {
        source: adapter.id,
        sourceListingId: { notIn: seen },
        isActive: true,
      },
      data: { isActive: false },
    });
    deactivated += res.count;
  }

  const finishedAt = new Date();
  await prisma.run.update({
    where: { id: run.id },
    data: {
      status: errors.length && persisted === 0 ? "failed" : "completed",
      finishedAt,
      stats: JSON.stringify({ total, persisted, bySource, deactivated, errors, warnings }),
    },
  });

  return {
    runId: run.id,
    total,
    persisted,
    bySource,
    deactivated,
    errors,
    warnings,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
  };
}

async function persistListing(l: Listing): Promise<void> {
  const data = {
    url: l.url,
    title: l.title ?? null,
    barrio: l.barrio ?? null,
    conjunto: l.conjunto ?? null,
    city: l.city ?? null,
    address: l.address ?? null,
    lat: l.lat ?? null,
    lng: l.lng ?? null,
    geocodePrecision: l.geocodePrecision ?? null,
    areaM2: l.areaM2 ?? null,
    bedrooms: l.bedrooms ?? null,
    bathrooms: l.bathrooms ?? null,
    parking: l.parking ?? null,
    price: l.price ?? null,
    admin: l.admin ?? null,
    estrato: l.estrato ?? null,
    currency: l.currency ?? "COP",
    agency: l.agency ?? null,
    phone: l.phone ?? null,
    hasWhatsapp: l.hasWhatsapp ?? false,
    rawJson: l.rawJson ?? null,
    isActive: true,
  };
  await prisma.listing.upsert({
    where: {
      source_sourceListingId: { source: l.source, sourceListingId: l.sourceListingId },
    },
    create: { source: l.source, sourceListingId: l.sourceListingId, ...data },
    update: data,
  });
}
