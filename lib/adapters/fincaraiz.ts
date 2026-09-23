import { DEPARTMENT_SLUG } from "@/lib/config";
import type { Listing, ResolvedCrawlParams } from "@/lib/core/schema";
import { titleCase } from "@/lib/util/text";
import { extractNextData, absolutize } from "@/lib/adapters/base/parse";
import { HttpClient } from "@/lib/adapters/base/httpClient";
import type { AdapterContext, SourceAdapter } from "@/lib/adapters/types";

const BASE = "https://www.fincaraiz.com.co";

/** Shape of the bits of __NEXT_DATA__ we rely on (everything else is ignored). */
interface FrCurrency {
  id?: number;
  name?: string;
}
interface FrPrice {
  amount?: number;
  admin_included?: number;
  hidePrice?: boolean;
  currency?: FrCurrency;
}
interface FrCommonExpenses {
  amount?: number;
}
interface FrOwner {
  name?: string;
  masked_phone?: string | null;
  whatsapp_phone?: string | null;
  has_whatsapp?: boolean;
}
interface FrLocationNode {
  name?: string;
  location_type?: string;
}
interface FrLocations {
  location_main?: FrLocationNode | null;
  neighbourhood?: FrLocationNode[] | null;
}
interface FrProject {
  name?: string;
}
interface FrItem {
  id?: number | string;
  code?: string;
  title?: string;
  address?: string;
  price?: FrPrice;
  commonExpenses?: FrCommonExpenses;
  include_administration?: boolean;
  m2?: number;
  m2Built?: number;
  m2apto?: number;
  m2Terrain?: number;
  bedrooms?: number;
  rooms?: number;
  bathrooms?: number;
  garage?: number;
  stratum?: number;
  condominium?: boolean;
  project?: FrProject | null;
  latitude?: number | string;
  longitude?: number | string;
  link?: string;
  owner?: FrOwner | null;
  locations?: FrLocations | null;
}
interface FrPaginatorInfo {
  currentPage?: number;
  lastPage?: number;
  perPage?: number;
  total?: number;
}
interface FrSearchFast {
  data?: FrItem[];
  paginatorInfo?: FrPaginatorInfo;
}
interface FrNextData {
  props?: {
    pageProps?: {
      fetchResult?: {
        searchFast?: FrSearchFast;
      };
    };
  };
}

/** propertyType -> FincaRaíz path slug. */
function typeSlug(t: ResolvedCrawlParams["propertyType"]): string {
  return t === "apartamento" ? "apartamentos" : "casas";
}

/** Build the list URL for a given city + page (path-based pagination; ?pagina is ignored). */
function listUrl(typeSlugStr: string, city: string, page: number): string {
  const path = `${BASE}/arriendo/${typeSlugStr}/${city}/${DEPARTMENT_SLUG}`;
  return page > 1 ? `${path}/pagina${page}` : path;
}

function toNum(v: number | string | undefined | null): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

/** estrato is 1-6; FincaRaíz sometimes returns 0 or junk like 110 -> null. */
function cleanEstrato(s: number | undefined): number | null {
  if (typeof s !== "number" || !Number.isInteger(s)) return null;
  return s >= 1 && s <= 6 ? s : null;
}

/** A positive int (m2/beds/baths/parking) or null. */
function posIntOrNull(v: number | undefined): number | null {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.trunc(v) : null;
}

/** garage 0 is a valid "no parking" answer; keep 0+, null on absent/invalid. */
function nonNegIntOrNull(v: number | undefined): number | null {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.trunc(v) : null;
}

function normalize(it: FrItem): Listing | null {
  const id = it.id != null ? String(it.id) : it.code;
  if (!id) return null;

  const url = absolutize(BASE, it.link);
  if (!url) return null; // url is required and must be a real http(s) URL

  const lat = toNum(it.latitude);
  const lng = toNum(it.longitude);
  const hasCoords = lat != null && lng != null;

  // price.amount = base rent. commonExpenses.amount = the real numeric admin fee.
  const price = it.price && typeof it.price.amount === "number" && it.price.amount > 0
    ? it.price.amount
    : null;
  const adminFee = it.commonExpenses && typeof it.commonExpenses.amount === "number" && it.commonExpenses.amount > 0
    ? it.commonExpenses.amount
    : null;

  // primary area: m2 (falls back to m2Built / m2apto / m2Terrain).
  const area =
    posIntOrNull(it.m2) ??
    posIntOrNull(it.m2Built) ??
    posIntOrNull(it.m2apto) ??
    posIntOrNull(it.m2Terrain);

  const loc = it.locations;
  const main = loc?.location_main;
  const barrioName =
    main?.name ||
    (Array.isArray(loc?.neighbourhood) && loc?.neighbourhood?.[0]?.name) ||
    null;

  // condominium is only a boolean flag; expose a name only if the project carries one.
  const conjunto = it.project && typeof it.project.name === "string" && it.project.name.trim()
    ? titleCase(it.project.name.trim())
    : null;

  const owner = it.owner;
  // masked_phone is like "+5731" (truncated) -> not a usable number. Only take a
  // full whatsapp_phone when present (it never was in live samples, but be defensive).
  const waPhone = owner?.whatsapp_phone && /\d{7,}/.test(owner.whatsapp_phone)
    ? owner.whatsapp_phone.replace(/[\s-]/g, "")
    : null;

  return {
    source: "fincaraiz",
    sourceListingId: id,
    url,
    title: it.title?.trim() || null,
    barrio: barrioName ? titleCase(barrioName) : null,
    conjunto,
    city: null, // set per-iteration by the caller (city slug -> proper case)
    address: it.address?.trim() || null,
    lat: hasCoords ? lat : null,
    lng: hasCoords ? lng : null,
    geocodePrecision: hasCoords ? "source" : null,
    areaM2: area,
    bedrooms: posIntOrNull(it.bedrooms) ?? posIntOrNull(it.rooms),
    bathrooms: posIntOrNull(it.bathrooms),
    parking: nonNegIntOrNull(it.garage),
    price,
    admin: adminFee,
    estrato: cleanEstrato(it.stratum),
    currency: "COP",
    agency: owner?.name?.trim() || null,
    phone: waPhone,
    hasWhatsapp: owner?.has_whatsapp === true,
    rawJson: JSON.stringify(it),
  };
}

function cityLabel(city: string): string {
  return titleCase(city.replace(/-/g, " "));
}

export const fincaraizAdapter: SourceAdapter = {
  id: "fincaraiz",
  label: "FincaRaíz",
  tier: "A",
  domain: "fincaraiz.com.co",

  async *fetchList(params: ResolvedCrawlParams, ctx: AdapterContext) {
    const http = new HttpClient();
    const slug = typeSlug(params.propertyType);

    for (const city of params.cities) {
      if (ctx.signal?.aborted) return;
      const label = cityLabel(city);
      let page = 1;
      let lastPage = 1;

      do {
        if (ctx.signal?.aborted) return;
        const url = listUrl(slug, city, page);

        let html: string;
        try {
          html = await http.getText(url, { via: "auto" });
        } catch (e) {
          ctx.log(`fincaraiz: ${city} page ${page} failed: ${(e as Error).message}`);
          break;
        }

        const next = extractNextData<FrNextData>(html);
        const searchFast = next?.props?.pageProps?.fetchResult?.searchFast;
        if (!searchFast) {
          ctx.log(`fincaraiz: ${city} page ${page} — no searchFast payload, stopping`);
          break;
        }

        const info = searchFast.paginatorInfo ?? {};
        lastPage = typeof info.lastPage === "number" && info.lastPage > 0 ? info.lastPage : page;

        const items = Array.isArray(searchFast.data) ? searchFast.data : [];
        let emitted = 0;
        for (const it of items) {
          const l = normalize(it);
          if (l) {
            l.city = label;
            emitted++;
            yield l;
          }
        }

        ctx.log(`fincaraiz: ${city} page ${page}/${lastPage} (${emitted}/${items.length})`);

        // Defensive: if a page returns nothing, don't loop forever.
        if (items.length === 0) break;
        page++;
      } while (page <= lastPage && page <= params.maxPagesPerSource);
    }
  },
};

export default fincaraizAdapter;
