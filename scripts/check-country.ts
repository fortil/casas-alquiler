import "dotenv/config";
import { reconDomain } from "@/lib/core/discovery/recon";

/**
 * Debug helper: print the country verdict + evidence for one domain.
 *   npx tsx scripts/check-country.ts <domain>
 */
async function main() {
  const domain = process.argv[2];
  if (!domain) throw new Error("usage: npx tsx scripts/check-country.ts <domain>");
  const r = await reconDomain(domain, { cities: ["Jamundí", "Cali"] });
  console.log(JSON.stringify({ domain, relevance: r.relevance, country: r.country }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
