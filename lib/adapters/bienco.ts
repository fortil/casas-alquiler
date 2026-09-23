import { CITY_DANE } from "@/lib/config";
import type { Listing, ResolvedCrawlParams } from "@/lib/core/schema";
import { extractPhone, parseArea, parsePriceCOP, titleCase } from "@/lib/util/text";
import { HttpClient } from "@/lib/adapters/base/httpClient";
import type { AdapterContext, SourceAdapter } from "@/lib/adapters/types";

const BASE = "https://bienco.com.co";

interface BiencoItem {
  codpro: number;
  address?: string;
  city?: string;
  city_zone?: string;
  neighborhood?: string;
  area_cons?: number;
  area_lot?: number;
  bedrooms?: number;
  bathrooms?: number;
  parking?: number;
  price?: string;
  rent?: number;
  administration?: number;
  latitude?: string;
  longitude?: string;
  description?: string;
  real_state_name?: string;
  stratum?: number;
}

interface BiencoList {
  total: number;
  last_page: number;
  current_page: number;
  data: BiencoItem[];
}

function typeCode(t: ResolvedCrawlParams["propertyType"]): number {
  return t === "apartamento" ? 1 : 2; // 2 = CASA
}

function normalize(it: BiencoItem): Listing | null {
  if (!it.codpro) return null;
  const price = it.rent && it.rent > 0 ? it.rent : parsePriceCOP(it.price);
  const lat = it.latitude ? parseFloat(it.latitude) : null;
  const lng = it.longitude ? parseFloat(it.longitude) : null;
  const area = it.area_cons && it.area_cons > 0 ? it.area_cons : parseArea(it.area_lot ?? null);

  return {
    source: "bienco",
    sourceListingId: String(it.codpro),
    url: `${BASE}/inmuebles/${it.codpro}`,
    title: null,
    barrio: it.neighborhood ? titleCase(it.neighborhood) : null,
    conjunto: null, // only on the detail endpoint (address_alt/project_name)
    city: it.city?.trim() || null,
    address: it.address?.trim() || null,
    lat: Number.isFinite(lat as number) ? lat : null,
    lng: Number.isFinite(lng as number) ? lng : null,
    geocodePrecision: lat && lng ? "source" : null,
    areaM2: area,
    bedrooms: it.bedrooms ?? null,
    bathrooms: it.bathrooms ?? null,
    parking: it.parking ?? null,
    price,
    admin: it.administration ?? null,
    estrato: it.stratum ?? null,
    currency: "COP",
    agency: it.real_state_name ?? null,
    phone: extractPhone(it.description),
    hasWhatsapp: false,
    rawJson: JSON.stringify(it),
  };
}

export const biencoAdapter: SourceAdapter = {
  id: "bienco",
  label: "Bienco",
  tier: "A",
  domain: "bienco.com.co",

  async *fetchList(params: ResolvedCrawlParams, ctx: AdapterContext) {
    const http = new HttpClient();
    const type = typeCode(params.propertyType);
    for (const city of params.cities) {
      const dane = CITY_DANE[city];
      if (!dane) {
        ctx.log(`bienco: no DANE code for "${city}", skipping`);
        continue;
      }
      let page = 1;
      let lastPage = 1;
      do {
        if (ctx.signal?.aborted) return;
        const url = `${BASE}/api/properties?city=${dane}&biz=1&type=${type}&page=${page}`;
        let data: BiencoList;
        try {
          data = await http.getJson<BiencoList>(url);
        } catch (e) {
          ctx.log(`bienco: ${city} page ${page} failed: ${(e as Error).message}`);
          break;
        }
        lastPage = data.last_page ?? 1;
        for (const it of data.data ?? []) {
          const l = normalize(it);
          if (l) yield l;
        }
        ctx.log(`bienco: ${city} page ${page}/${lastPage} (${data.data?.length ?? 0})`);
        page++;
      } while (page <= lastPage && page <= params.maxPagesPerSource);
    }
  },
};

export default biencoAdapter;
