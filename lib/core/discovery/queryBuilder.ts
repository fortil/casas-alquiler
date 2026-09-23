import { CITIES, SOUTHERN_CALI_ZONES } from "@/lib/config";
import { titleCase } from "@/lib/util/text";

export interface QueryBuilderInput {
  cities: string[]; // slugs, e.g. ["jamundi", "cali"]
  propertyType: "casa" | "apartamento";
  /** barrio/comuna names to sample a few from for zone-specific queries */
  zones?: string[];
  /** how many zone-specific queries to include (default 3) */
  zoneSampleSize?: number;
  /** cap the total number of queries returned (default: no cap) */
  maxQueries?: number;
}

const CITY_LABELS: Record<string, string> = Object.fromEntries(
  CITIES.map((c) => [c.slug, c.label]),
);

function cityLabel(slug: string): string {
  return CITY_LABELS[slug] ?? titleCase(slug);
}

/**
 * Build the set of search-engine query strings for a discovery run. Purely
 * deterministic (no randomness) so results are testable and stable across
 * runs; zone sampling takes the first N entries of `zones`, not a random pick.
 */
export function buildDiscoveryQueries(input: QueryBuilderInput): string[] {
  const tipo = input.propertyType;
  const tipoPlural = `${tipo}s`;
  const queries: string[] = [];

  // Every query anchors the country: Google otherwise surfaces foreign portals
  // (e.g. "portal inmobiliario ..." is a Chilean brand, and southern-Cali barrio
  // names like "San Fernando" also exist in Guadalajara or Bogotá).
  for (const slug of input.cities) {
    const ciudad = cityLabel(slug);
    queries.push(`arriendo ${tipoPlural} ${ciudad} Colombia`);
    queries.push(`inmobiliaria ${ciudad} Colombia arriendo ${tipoPlural}`);
    queries.push(`${tipo} en arriendo ${ciudad} Valle del Cauca Colombia`);
    // One .co-restricted angle per city — a cheap extra filter, never the only
    // source: legitimate Colombian agencies live on .com too.
    queries.push(`site:.co arriendo ${tipoPlural} ${ciudad} Colombia`);
  }

  // City-independent: always included so an empty `cities` still yields queries.
  // Describes the service instead of naming a portal ("portal inmobiliario" is
  // Portalinmobiliario.com, MercadoLibre Chile's brand).
  queries.push(`portales de arriendo de vivienda en Colombia`);

  // Zone-specific queries only make sense for Cali's southern barrios.
  if (input.cities.includes("cali")) {
    const zones = input.zones ?? SOUTHERN_CALI_ZONES;
    const sampleSize = input.zoneSampleSize ?? 3;
    for (const zone of zones.slice(0, sampleSize)) {
      queries.push(`arriendo ${tipo} ${titleCase(zone)} Cali Colombia`);
    }
  }

  if (input.maxQueries != null && input.maxQueries > 0) {
    return queries.slice(0, input.maxQueries);
  }
  return queries;
}
