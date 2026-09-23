import pLimit from "p-limit";
import { ADAPTER_DOMAINS } from "@/lib/adapters";
import { CITIES } from "@/lib/config";
import { buildDiscoveryQueries } from "@/lib/core/discovery/queryBuilder";
import { classifyDomain, dedupeByDomain, type ExclusionReason } from "@/lib/core/discovery/domainFilter";
import { reconDomain, type CandidateRecon } from "@/lib/core/discovery/recon";
import { serpSearch } from "@/lib/providers/serpSearch";
import { DiscoverParamsSchema, type DiscoverParams } from "@/lib/core/discovery/schema";

export interface FoundVia {
  query: string;
  url: string;
  title: string;
  engine: string;
}

export interface CandidateSource {
  domain: string;
  status: "new" | ExclusionReason;
  knownReason?: string;
  foundVia: FoundVia[];
  mentionCount: number;
  recon?: CandidateRecon;
  discoveredAt: string;
}

export interface DiscoverResult {
  candidates: CandidateSource[];
  errors: string[];
}

const SEARCH_CONCURRENCY = 4;
const RECON_CONCURRENCY = 4;

/**
 * Full discovery pipeline: build queries -> search (bounded concurrency) ->
 * dedupe/classify domains -> recon only the "new" ones (capped). A failing
 * query or a failing recon never aborts the others (Promise.allSettled).
 */
export async function runDiscovery(rawParams: DiscoverParams): Promise<DiscoverResult> {
  const params = DiscoverParamsSchema.parse(rawParams);
  const errors: string[] = [];

  const queries = buildDiscoveryQueries({
    cities: params.cities,
    propertyType: params.propertyType,
    maxQueries: params.maxQueries,
  });

  const searchLimit = pLimit(SEARCH_CONCURRENCY);
  const queryResults = await Promise.allSettled(
    queries.map((q) => searchLimit(() => serpSearch(q))),
  );

  const hits: { url: string; title: string; query: string; engine: string }[] = [];
  queryResults.forEach((r, i) => {
    if (r.status === "fulfilled") {
      for (const item of r.value) {
        hits.push({ url: item.url, title: item.title, query: queries[i], engine: item.engine });
      }
    } else {
      errors.push(`query "${queries[i]}" failed: ${(r.reason as Error)?.message ?? r.reason}`);
    }
  });

  const grouped = dedupeByDomain(hits);
  const implementedDomains = Object.values(ADAPTER_DOMAINS);
  const cityLabels = CITIES.map((c) => c.label);
  const discoveredAt = new Date().toISOString();

  const candidates: CandidateSource[] = [];
  for (const [domain, domainHits] of grouped) {
    const foundVia = domainHits.map((h) => ({
      query: h.query,
      url: h.url,
      title: h.title,
      engine: h.engine,
    }));
    const classification = classifyDomain(domain, implementedDomains);
    candidates.push({
      domain,
      status: classification?.reason ?? "new",
      knownReason: classification?.note,
      foundVia,
      mentionCount: domainHits.length,
      discoveredAt,
    });
  }

  // Recon only "new" candidates, most-mentioned first, capped at maxCandidates.
  // Known/blocklisted/foreign-TLD candidates never occupy a slot in that cap —
  // a foreign TLD is visible before any fetch. A content-verdict foreign (the
  // recon's country check) is only known AFTER the recon, so it does consume a
  // slot; that tradeoff is accepted — no backfill loop. Layers upstream (query
  // anchoring + SERP country params) exist so few foreign sites reach recon.
  const toRecon = candidates
    .filter((c) => c.status === "new")
    .sort((a, b) => b.mentionCount - a.mentionCount)
    .slice(0, params.maxCandidates);

  const reconLimit = pLimit(RECON_CONCURRENCY);
  const reconResults = await Promise.allSettled(
    toRecon.map((c) => reconLimit(() => reconDomain(c.domain, { cities: cityLabels }))),
  );
  reconResults.forEach((r, i) => {
    if (r.status === "fulfilled") {
      toRecon[i].recon = r.value;
      if (r.value.country.verdict === "foreign") {
        toRecon[i].status = "foreign";
        toRecon[i].knownReason = `sitio fuera de Colombia: ${r.value.country.evidence.join("; ")}`;
      }
    } else {
      errors.push(`recon "${toRecon[i].domain}" failed: ${(r.reason as Error)?.message ?? r.reason}`);
    }
  });

  return { candidates, errors };
}
