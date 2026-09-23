import "dotenv/config";
import { ALL_ADAPTERS } from "@/lib/adapters";
import { CrawlParamsSchema, type Listing } from "@/lib/core/schema";

/**
 * Live smoke test: run each adapter, collect a few listings, print a sample.
 * Usage: npm run smoke -- [adapterId]   (optional filter)
 */
const only = process.argv[2];
const MAX_COLLECT = 3;
const PER_ADAPTER_MS = 45000;

function summarize(l: Listing): string {
  return [
    `id=${l.sourceListingId}`,
    `${l.barrio ?? "?"}/${l.conjunto ?? "?"}`,
    `${l.city ?? "?"}`,
    `${l.areaM2 ?? "?"}m²`,
    `$${l.price ?? "?"}`,
    l.lat && l.lng ? `(${l.lat.toFixed(4)},${l.lng.toFixed(4)})` : "(no geo)",
    l.phone ? `tel=${l.phone}` : "",
    l.agency ? `[${l.agency}]` : "",
  ]
    .filter(Boolean)
    .join("  ");
}

async function main() {
  const params = CrawlParamsSchema.parse({
    cities: ["jamundi", "cali"],
    propertyType: "casa",
    maxPagesPerSource: 1,
    includeHardSources: true,
  });

  const adapters = only ? ALL_ADAPTERS.filter((a) => a.id === only) : ALL_ADAPTERS;

  for (const a of adapters) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PER_ADAPTER_MS);
    const ctx = { log: (_m: string) => {}, signal: controller.signal };
    const collected: Listing[] = [];
    const start = Date.now();
    let errored = "";
    try {
      for await (const l of a.fetchList(params, ctx)) {
        collected.push(l);
        if (collected.length >= MAX_COLLECT) break;
      }
    } catch (e) {
      errored = (e as Error).message;
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
    const ms = Date.now() - start;
    const tag = a.requiresBrightData ? " (needs BrightData)" : "";
    console.log(`\n=== ${a.id} [tier ${a.tier}]${tag}  ${collected.length} listings in ${ms}ms`);
    if (errored) console.log(`  ERROR: ${errored}`);
    for (const l of collected) console.log("  • " + summarize(l));
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
