import type { Listing as PrismaListing } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import type { DistanceMode } from "@/lib/config";
import {
  type GeoPoint,
  type GeocodePrecision,
  type Listing,
} from "@/lib/core/schema";
import { dedupeListings } from "@/lib/core/dedup";
import { rankListings, type RankResult } from "@/lib/core/pipeline";
import type { ScoreWeights } from "@/lib/core/score";
import { norm } from "@/lib/util/text";

export interface SearchOptions {
  cities?: string[];
  refPoint: GeoPoint;
  maxDistKm: number;
  minAreaM2: number;
  minBedrooms?: number;
  minPrice?: number;
  maxPrice?: number;
  weights: ScoreWeights;
  distanceMode: DistanceMode;
  southernCaliOnly?: boolean;
  southernZones?: string[];
  topN?: number;
}

export interface SearchResult extends RankResult {
  generatedAt: string;
  lastRunAt: string | null;
  totalActive: number;
}

/** Convert a stored row to the domain model. */
export function rowToListing(r: PrismaListing): Listing {
  return {
    source: r.source,
    sourceListingId: r.sourceListingId,
    url: r.url,
    title: r.title,
    barrio: r.barrio,
    conjunto: r.conjunto,
    city: r.city,
    address: r.address,
    lat: r.lat,
    lng: r.lng,
    geocodePrecision: (r.geocodePrecision as GeocodePrecision | null) ?? undefined,
    areaM2: r.areaM2,
    bedrooms: r.bedrooms,
    bathrooms: r.bathrooms,
    parking: r.parking,
    price: r.price,
    admin: r.admin,
    estrato: r.estrato,
    currency: r.currency,
    agency: r.agency,
    phone: r.phone,
    hasWhatsapp: r.hasWhatsapp,
    rawJson: r.rawJson,
  };
}

/** Rank stored, active listings against the given parameters (Mode A read path). */
export async function searchStored(opts: SearchOptions): Promise<SearchResult> {
  const rows = await prisma.listing.findMany({ where: { isActive: true } });
  const totalActive = rows.length;

  let listings = rows.map(rowToListing);

  // City narrowing (stored city is a label; match on normalized form).
  if (opts.cities && opts.cities.length) {
    const set = new Set(opts.cities.map((c) => norm(c)));
    listings = listings.filter((l) => set.has(norm(l.city)));
  }

  // Cross-source dedup before scoring.
  const deduped = dedupeListings(listings).map((m) => ({ ...m, sources: m.mergedSources }));

  const result = await rankListings(deduped, {
    refPoint: opts.refPoint,
    maxDistKm: opts.maxDistKm,
    minAreaM2: opts.minAreaM2,
    minBedrooms: opts.minBedrooms,
    minPrice: opts.minPrice,
    maxPrice: opts.maxPrice,
    weights: opts.weights,
    distanceMode: opts.distanceMode,
    southernCaliOnly: opts.southernCaliOnly,
    southernZones: opts.southernZones,
    topN: opts.topN,
  });

  const lastRun = await prisma.run.findFirst({
    where: { status: "completed" },
    orderBy: { finishedAt: "desc" },
  });

  return {
    ...result,
    generatedAt: new Date().toISOString(),
    lastRunAt: lastRun?.finishedAt?.toISOString() ?? null,
    totalActive,
  };
}
