import type { Listing, ResolvedCrawlParams } from "@/lib/core/schema";
import type { AdapterContext, SourceAdapter } from "@/lib/adapters/types";
import { HttpClient } from "@/lib/adapters/base/httpClient";
import { extractJsonLd, findJsonLdByType, load } from "@/lib/adapters/base/parse";
import {
  extractPhone,
  norm,
  parseArea,
  parseIntSafe,
  parsePriceCOP,
  titleCase,
} from "@/lib/util/text";

const BASE = "https://www.ciencuadras.com";

/** Words that mark a neighborhood/building string as actually being a conjunto. */
const CONJUNTO_HINTS = [
  "conjunto",
  "unidad",
  "condominio",
  "edificio",
  "urbanizacion",
  "ciudadela",
  "reservado",
];

/**
 * Ciencuadras renders the listing page with Angular Universal. The full,
 * rich per-listing payload lives in the Angular TransferState blob embedded
 * in the HTML (cache key `results-/arriendo/{city}/{type}`), split across two
 * arrays: `highlights` (featured) and `results` (the rest). Together they make
 * up the ~28 cards on the page, each carrying price, area, coords, bedrooms,
 * bathrooms, parking, estrato, admin, agency and phone/WhatsApp.
 *
 * The 4 JSON-LD blocks (the ItemList one) are a leaner mirror of the same
 * cards (price, area, coords, bathrooms, url) and are used as a fallback when
 * the TransferState cannot be parsed.
 */
interface CcCoords {
  latitude?: number | string;
  longitude?: number | string;
}

interface CcCard {
  id?: string | number;
  url?: string;
  code?: string;
  rentPrice?: number | string;
  salePrice?: number | string;
  area?: string | number;
  privateArea?: string | number;
  showCardArea?: string | number;
  rooms?: string | number;
  baths?: string | number;
  garages?: string | number;
  stratum?: string | number;
  adminValue?: number | string;
  coordinates?: CcCoords;
  city?: string;
  neighborhood?: string;
  neighborhood_integrator?: string;
  address?: string;
  userName?: string;
  realEstateType?: string;
  offerType?: string;
  contactPhone?: string;
  contactWhatsapp?: string;
}

interface CcResultsCache {
  data?: {
    total?: number;
    totalPages?: number;
    highlights?: CcCard[];
    results?: CcCard[];
  };
}

/** TransferState `phoneList` entry on the detail page. */
interface CcPhoneEntry {
  phone?: string;
  typeAction?: string;
  isVisible?: string;
}

interface CcGeneralData {
  propertyId?: number | string;
  bedRoomNum?: string | number;
  bathRoomNum?: string | number;
  parkingNum?: string | number;
  stratum?: string | number;
  leaseFee?: string | number;
  price?: string | number;
  adminValue?: string | number | null;
  builtArea?: string | number;
  privateArea?: string | number;
  buildName?: string | null;
  address?: string | null;
  neighborhoodIntegrator?: string | null;
  neighborhoodName?: string | null;
  cityName?: string | null;
  whatsAppContact?: string | null;
  phoneList?: CcPhoneEntry[];
  description?: string | null;
}

interface CcDetailCache {
  generalData?: CcGeneralData;
  dataStrip?: { realStateName?: string | null };
}

function typeSlug(t: ResolvedCrawlParams["propertyType"]): string {
  return t === "apartamento" ? "apartamento" : "casa";
}

function num(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

function intOrNull(v: unknown): number | null {
  const n = parseIntSafe(typeof v === "number" || typeof v === "string" ? v : null);
  return n != null && n >= 0 ? n : null;
}

function estratoOrNull(v: unknown): number | null {
  const n = intOrNull(v);
  return n != null && n >= 1 && n <= 6 ? n : null;
}

/** Pull `id` out of a `/inmueble/...-{id}` slug. */
function idFromUrl(url: string | undefined | null): string | null {
  if (!url) return null;
  const m = url.match(/-(\d+)(?:[/?#]|$)/);
  return m ? m[1] : null;
}

/** Take a conjunto only when the string clearly names one. */
function conjuntoFrom(...candidates: (string | null | undefined)[]): string | null {
  for (const c of candidates) {
    const n = norm(c);
    if (n && CONJUNTO_HINTS.some((h) => n.includes(h))) return titleCase(c as string);
  }
  return null;
}

/**
 * Decode the Angular TransferState blob for a given cache key. The blob HTML-
 * encodes quotes/ampersands/brackets (`&q;` `&a;` `&l;` `&g;`); we locate the
 * object after the key and walk braces to extract a balanced JSON object.
 */
function decodeTransferState<T>(html: string, key: string): T | null {
  const marker = `${key}&q;:`;
  const at = html.indexOf(marker);
  if (at < 0) return null;
  let i = at + marker.length;
  if (html[i] !== "{") return null;
  let depth = 0;
  const start = i;
  for (; i < html.length; i++) {
    const c = html[i];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) {
        i++;
        break;
      }
    }
  }
  const raw = html
    .slice(start, i)
    .replace(/&q;/g, '"')
    .replace(/&l;/g, "<")
    .replace(/&g;/g, ">")
    .replace(/&a;/g, "&");
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function normalizeCard(card: CcCard): Listing | null {
  const url = card.url ? new URL(card.url, BASE).toString() : null;
  const id = card.id != null ? String(card.id) : idFromUrl(url);
  if (!url || !id) return null;

  const price = parsePriceCOP(card.rentPrice ?? null);
  const area =
    parseArea(card.area ?? null) ??
    parseArea(card.privateArea ?? null) ??
    parseArea(card.showCardArea ?? null);
  const lat = num(card.coordinates?.latitude);
  const lng = num(card.coordinates?.longitude);
  const admin = parsePriceCOP(card.adminValue ?? null);
  const neighborhood = card.neighborhood || card.neighborhood_integrator || null;
  const phone =
    extractPhone(card.contactWhatsapp) ?? extractPhone(card.contactPhone);
  const hasWhatsapp = !!extractPhone(card.contactWhatsapp);

  return {
    source: "ciencuadras",
    sourceListingId: id,
    url,
    title: null,
    barrio: neighborhood ? titleCase(neighborhood) : null,
    conjunto: conjuntoFrom(neighborhood, card.address),
    city: card.city?.trim() || null,
    address: card.address?.trim() || null,
    lat: lat != null ? lat : null,
    lng: lng != null ? lng : null,
    geocodePrecision: lat != null && lng != null ? "source" : null,
    areaM2: area,
    bedrooms: intOrNull(card.rooms),
    bathrooms: intOrNull(card.baths),
    parking: intOrNull(card.garages),
    price,
    admin: admin && admin > 0 ? admin : null,
    estrato: estratoOrNull(card.stratum),
    currency: "COP",
    agency: card.userName?.trim() || null,
    phone,
    hasWhatsapp,
    rawJson: JSON.stringify(card),
  };
}

/** Fallback: build minimal listings from the ItemList JSON-LD block. */
function normalizeFromJsonLd(html: string): Listing[] {
  const $ = load(html);
  const itemList = findJsonLdByType(extractJsonLd($), "ItemList");
  const elements = itemList?.["itemListElement"];
  if (!Array.isArray(elements)) return [];
  const out: Listing[] = [];
  for (const el of elements) {
    if (!el || typeof el !== "object") continue;
    const item = (el as { item?: Record<string, unknown> }).item;
    if (!item) continue;
    const url = typeof item["url"] === "string" ? item["url"] : null;
    const id = idFromUrl(url);
    if (!url || !id) continue;

    const offers = item["offers"] as Record<string, unknown> | undefined;
    const itemOffered = offers?.["itemOffered"] as Record<string, unknown> | undefined;
    const geo = itemOffered?.["geo"] as Record<string, unknown> | undefined;
    const floorSize = itemOffered?.["floorSize"] as Record<string, unknown> | undefined;

    const name = typeof item["name"] === "string" ? item["name"] : "";
    // name: "{Type} en arriendo en {address}, {BARRIO}, {City} - Cód. {code}"
    const beforeCod = name.split(/\s*-\s*C[oó]d\./i)[0] ?? "";
    const parts = beforeCod.split(",").map((p) => p.trim()).filter(Boolean);
    const barrio = parts.length >= 2 ? parts[parts.length - 2] : null;
    const city = parts.length >= 1 ? parts[parts.length - 1] : null;

    const price = parsePriceCOP(offers?.["price"] as string | undefined);
    const lat = num(geo?.["latitude"]);
    const lng = num(geo?.["longitude"]);

    out.push({
      source: "ciencuadras",
      sourceListingId: id,
      url: new URL(url, BASE).toString(),
      title: null,
      barrio: barrio ? titleCase(barrio) : null,
      conjunto: conjuntoFrom(barrio),
      city: city?.trim() || null,
      address: null,
      lat: lat != null ? lat : null,
      lng: lng != null ? lng : null,
      geocodePrecision: lat != null && lng != null ? "source" : null,
      areaM2: parseArea(floorSize?.["value"] as string | undefined),
      bedrooms: intOrNull(itemOffered?.["numberOfRooms"]),
      bathrooms: intOrNull(itemOffered?.["numberOfBathroomsTotal"]),
      parking: null,
      price,
      admin: null,
      estrato: null,
      currency: "COP",
      agency: null,
      phone: null,
      hasWhatsapp: false,
      rawJson: JSON.stringify(item),
    });
  }
  return out;
}

export const ciencuadrasAdapter: SourceAdapter = {
  id: "ciencuadras",
  label: "Ciencuadras",
  tier: "A",
  domain: "ciencuadras.com",

  async *fetchList(params: ResolvedCrawlParams, ctx: AdapterContext) {
    const http = new HttpClient();
    const slug = typeSlug(params.propertyType);

    for (const city of params.cities) {
      if (ctx.signal?.aborted) return;
      const path = `/arriendo/${city}/${slug}`;
      const seen = new Set<string>();
      const maxPages = Math.max(1, params.maxPagesPerSource);

      for (let page = 1; page <= maxPages; page++) {
        if (ctx.signal?.aborted) return;
        const url = `${BASE}${path}${page > 1 ? `?pagina=${page}` : ""}`;

        let html: string;
        try {
          html = await http.getText(url, { via: "auto" });
        } catch (e) {
          ctx.log(`ciencuadras: ${city} page ${page} failed: ${(e as Error).message}`);
          break;
        }

        // Primary: rich TransferState cards (highlights + results).
        const cache = decodeTransferState<CcResultsCache>(html, `results-${path}`);
        let cards: CcCard[] = [];
        if (cache?.data) {
          cards = [...(cache.data.highlights ?? []), ...(cache.data.results ?? [])];
        }

        let listings: Listing[];
        if (cards.length > 0) {
          listings = cards.map(normalizeCard).filter((l): l is Listing => l !== null);
        } else {
          // Fallback to the JSON-LD ItemList block.
          listings = normalizeFromJsonLd(html);
        }

        let fresh = 0;
        for (const l of listings) {
          if (seen.has(l.sourceListingId)) continue;
          seen.add(l.sourceListingId);
          fresh++;
          yield l;
        }

        ctx.log(
          `ciencuadras: ${city} page ${page} (${listings.length} parsed, ${fresh} new, ${seen.size} total)`,
        );

        // The SSR endpoint serves the same first page regardless of ?pagina=N,
        // so once a page contributes no new listings we are done for this city.
        if (fresh === 0) break;
        const totalPages = cache?.data?.totalPages;
        if (totalPages != null && page >= totalPages) break;
      }
    }
  },

  /**
   * Enrich a single listing from its detail page. Adds bedrooms, bathrooms,
   * parking, estrato, admin, agency, conjunto, phone + hasWhatsapp.
   */
  async fetchDetail(url: string, ctx: AdapterContext): Promise<Partial<Listing> | null> {
    const http = new HttpClient();
    let html: string;
    try {
      html = await http.getText(url, { via: "auto" });
    } catch (e) {
      ctx.log(`ciencuadras: detail ${url} failed: ${(e as Error).message}`);
      return null;
    }

    const path = new URL(url, BASE).pathname;
    const detail = decodeTransferState<CcDetailCache>(html, `detail-property-${path}`);
    const gd = detail?.generalData;

    if (!gd) {
      // Fall back to the Product JSON-LD block for the basics.
      const $ = load(html);
      const product = findJsonLdByType(extractJsonLd($), "Product");
      if (!product) return null;
      const offers = product["offers"] as Record<string, unknown> | undefined;
      const itemOffered = offers?.["itemOffered"] as Record<string, unknown> | undefined;
      const addProps = itemOffered?.["additionalProperty"];
      let estrato: number | null = null;
      let parking: number | null = null;
      if (Array.isArray(addProps)) {
        for (const p of addProps) {
          if (!p || typeof p !== "object") continue;
          const name = norm((p as { name?: string }).name);
          const value = (p as { value?: unknown }).value;
          if (name === "estrato") estrato = estratoOrNull(value);
          else if (name.startsWith("parqueadero")) parking = intOrNull(value);
        }
      }
      return {
        bedrooms: intOrNull(itemOffered?.["numberOfRooms"]),
        bathrooms: intOrNull(itemOffered?.["numberOfBathroomsTotal"]),
        parking,
        estrato,
        phone: extractPhone(product["description"] as string | undefined),
      };
    }

    // Prefer a WhatsApp-capable number; fall back to any phoneList entry.
    let phone = extractPhone(gd.whatsAppContact);
    let hasWhatsapp = !!phone;
    if (Array.isArray(gd.phoneList)) {
      for (const entry of gd.phoneList) {
        const p = extractPhone(entry.phone);
        if (!p) continue;
        const isWa = (entry.typeAction ?? "").toUpperCase().includes("WA");
        if (isWa) {
          phone = p;
          hasWhatsapp = true;
          break;
        }
        if (!phone) phone = p;
      }
    }
    if (!phone) phone = extractPhone(gd.description);

    const admin = parsePriceCOP(gd.adminValue ?? null);
    const area = parseArea(gd.builtArea ?? null) ?? parseArea(gd.privateArea ?? null);

    return {
      barrio:
        gd.neighborhoodIntegrator || gd.neighborhoodName
          ? titleCase((gd.neighborhoodIntegrator ?? gd.neighborhoodName) as string)
          : undefined,
      conjunto: conjuntoFrom(gd.buildName, gd.neighborhoodIntegrator, gd.neighborhoodName),
      city: gd.cityName?.trim() || undefined,
      address: gd.address?.trim() || undefined,
      areaM2: area ?? undefined,
      bedrooms: intOrNull(gd.bedRoomNum) ?? undefined,
      bathrooms: intOrNull(gd.bathRoomNum) ?? undefined,
      parking: intOrNull(gd.parkingNum) ?? undefined,
      price: parsePriceCOP(gd.leaseFee ?? null) ?? undefined,
      admin: admin && admin > 0 ? admin : undefined,
      estrato: estratoOrNull(gd.stratum) ?? undefined,
      agency: detail?.dataStrip?.realStateName?.trim() || undefined,
      phone: phone ?? undefined,
      hasWhatsapp,
    };
  },
};

export default ciencuadrasAdapter;
