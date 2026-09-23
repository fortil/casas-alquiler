import "dotenv/config";
import { runCrawl } from "@/lib/core/orchestrator";
import { defaultCities } from "@/lib/config";

/**
 * CLI crawler. Examples:
 *   npm run crawl -- --cities jamundi,cali --type casa --pages 20
 *   npm run crawl -- --hard --geocode
 */
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && i + 1 < process.argv.length && !process.argv[i + 1].startsWith("--")) {
    return process.argv[i + 1];
  }
  return undefined;
}
function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function main() {
  const cities = (arg("cities")?.split(",").map((s) => s.trim()).filter(Boolean)) ?? defaultCities();
  const propertyType = (arg("type") as "casa" | "apartamento") ?? "casa";
  const maxPagesPerSource = arg("pages") ? parseInt(arg("pages")!, 10) : 20;
  const maxPerSource = arg("per") ? parseInt(arg("per")!, 10) : 0;
  const includeHardSources = flag("hard");
  const geocode = flag("geocode");

  console.log(
    `Crawl: cities=${cities.join(",")} type=${propertyType} pages=${maxPagesPerSource} per=${maxPerSource || "∞"} hard=${includeHardSources} geocode=${geocode}`,
  );

  const result = await runCrawl(
    { cities, propertyType, maxPagesPerSource, maxPerSource, includeHardSources },
    { geocode, onLog: (m) => console.log("  " + m) },
  );

  console.log("\n=== Crawl complete ===");
  console.log(`Run ${result.runId}: ${result.persisted}/${result.total} persisted`);
  console.log("By source:", result.bySource);
  console.log(`Deactivated (no longer listed): ${result.deactivated}`);
  if (result.errors.length) {
    console.log(`Errors (${result.errors.length}):`);
    result.errors.slice(0, 20).forEach((e) => console.log("  - " + e));
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
