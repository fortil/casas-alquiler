import type { EvaluatedListing, Listing } from "@/lib/core/schema";

let seq = 0;

export function makeListing(over: Partial<Listing> = {}): Listing {
  seq++;
  return {
    source: "test",
    sourceListingId: `t${seq}`,
    url: `https://example.com/${seq}`,
    title: null,
    barrio: null,
    conjunto: null,
    city: "Cali",
    address: null,
    lat: 3.4,
    lng: -76.53,
    geocodePrecision: "source",
    areaM2: 100,
    bedrooms: 3,
    bathrooms: 2,
    parking: 1,
    price: 2000000,
    admin: 0,
    estrato: 4,
    currency: "COP",
    agency: null,
    phone: null,
    hasWhatsapp: false,
    rawJson: null,
    ...over,
  };
}

export function makeEvaluated(over: Partial<EvaluatedListing> = {}): EvaluatedListing {
  return { ...makeListing(over), distanceKm: 5, ...over };
}
