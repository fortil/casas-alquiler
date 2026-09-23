import { buildDiscoveryQueries } from "@/lib/core/discovery/queryBuilder";

/**
 * Prints the exact query list a discovery run would execute — pure, no network.
 *   npx tsx scripts/list-queries.ts [casa|apartamento] [ciudades csv]
 */
const propertyType = (process.argv[2] ?? "casa") as "casa" | "apartamento";
const cities = (process.argv[3] ?? "jamundi,cali").split(",");

const queries = buildDiscoveryQueries({ cities, propertyType });
console.log(`\n${queries.length} consultas para [${cities}] ${propertyType} (tope UI: 25):`);
queries.forEach((q, i) => console.log(`${String(i + 1).padStart(2)}. ${q}`));

// Determinism proof: second call returns the identical list.
const again = buildDiscoveryQueries({ cities, propertyType });
console.log(`\n¿Lista idéntica en una segunda llamada? ${JSON.stringify(queries) === JSON.stringify(again)}`);
