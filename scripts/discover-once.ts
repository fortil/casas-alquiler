import "dotenv/config";
import { runDiscovery } from "@/lib/core/discovery/pipeline";

/**
 * One-shot discovery run for manual verification:
 *   npx tsx scripts/discover-once.ts            # jamundi+cali, apartamento, defaults
 * Prints one line per candidate: status, domain, relevance, queries.
 */
async function main() {
  const result = await runDiscovery({
    cities: ["jamundi", "cali"],
    propertyType: "apartamento",
  });
  console.log(`\n=== ${result.candidates.length} candidatos, ${result.errors.length} errores ===`);
  for (const c of [...result.candidates].sort((a, b) => a.status.localeCompare(b.status) || b.mentionCount - a.mentionCount)) {
    const rel = c.recon ? c.recon.relevance.toFixed(2) : "—";
    console.log(
      `${c.status.padEnd(18)} ${c.domain.padEnd(38)} rel=${rel.padEnd(5)} menciones=${c.mentionCount}`,
    );
  }
  for (const e of result.errors) console.error(`ERROR: ${e}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
