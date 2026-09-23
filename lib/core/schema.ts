import { z } from "zod";

/**
 * Canonical domain model shared by every adapter, the scorer and the UI.
 * This is intentionally a superset: any field a source does not expose is null.
 */

export const GeocodePrecisionSchema = z.enum([
  "rooftop",
  "street",
  "barrio_centroid",
  "city",
  "source", // coordinates came straight from the listing/source
]);
export type GeocodePrecision = z.infer<typeof GeocodePrecisionSchema>;

export const ListingSchema = z.object({
  source: z.string(), // adapter id, e.g. "bienco"
  sourceListingId: z.string(), // stable id within that source
  url: z.string().url(),
  title: z.string().nullish(),

  barrio: z.string().nullish(),
  conjunto: z.string().nullish(),
  city: z.string().nullish(),
  address: z.string().nullish(),
  lat: z.number().finite().nullish(),
  lng: z.number().finite().nullish(),
  geocodePrecision: GeocodePrecisionSchema.nullish(),

  areaM2: z.number().positive().nullish(),
  bedrooms: z.number().int().nonnegative().nullish(),
  bathrooms: z.number().int().nonnegative().nullish(),
  parking: z.number().int().nonnegative().nullish(),

  price: z.number().nonnegative().nullish(),
  admin: z.number().nonnegative().nullish(),
  estrato: z.number().int().min(1).max(6).nullish(),
  currency: z.string().default("COP"),

  agency: z.string().nullish(),
  phone: z.string().nullish(),
  hasWhatsapp: z.boolean().default(false),

  rawJson: z.string().nullish(),
});
export type Listing = z.infer<typeof ListingSchema>;

/** One contributing listing after cross-source dedup (portal + its own URL). */
export interface SourceLink {
  source: string;
  url: string;
}

/** A listing with the distance to the reference point resolved (km). */
export type EvaluatedListing = Listing & {
  distanceKm: number | null;
  /** driving distance/time when distanceMode === "google_driving" */
  drivingKm?: number | null;
  drivingMin?: number | null;
  /** set after dedup: the source ids that collapsed into this record */
  sources?: string[];
  /** set after dedup: every portal + URL where this property was found */
  sourceLinks?: SourceLink[];
};

/** A scored + ranked listing returned to the UI. */
export type ScoredListing = EvaluatedListing & {
  costPerM2: number;
  score: number;
  rank: number;
};

/** Parameters that drive a crawl (Mode A). */
export const CrawlParamsSchema = z.object({
  cities: z.array(z.string()).default(["jamundi", "cali"]),
  propertyType: z.enum(["casa", "apartamento"]).default("casa"),
  business: z.literal("arriendo").default("arriendo"),
  maxPagesPerSource: z.number().int().positive().default(20),
  /** cap on listings fetched per portal (0 = no cap; binds before page limit) */
  maxPerSource: z.number().int().nonnegative().default(0),
  /** restrict Cali results to the configured "southern Cali" barrios */
  southernCaliOnly: z.boolean().default(false),
  /** opt-in: include Tier C (Bright Data / headless) sources */
  includeHardSources: z.boolean().default(false),
});
export type CrawlParams = z.input<typeof CrawlParamsSchema>;
export type ResolvedCrawlParams = z.infer<typeof CrawlParamsSchema>;

/** A geographic point. */
export interface GeoPoint {
  lat: number;
  lng: number;
}

export function isValidPoint(p: Partial<GeoPoint> | null | undefined): p is GeoPoint {
  return !!p && Number.isFinite(p.lat) && Number.isFinite(p.lng);
}
