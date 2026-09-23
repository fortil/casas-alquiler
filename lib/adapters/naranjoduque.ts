import { load, absolutize } from "@/lib/adapters/base/parse";
import { HttpClient } from "@/lib/adapters/base/httpClient";
import { norm, titleCase, parsePriceCOP, parseArea, parseIntSafe } from "@/lib/util/text";
import type { Listing, ResolvedCrawlParams } from "@/lib/core/schema";
import type { AdapterContext, SourceAdapter } from "@/lib/adapters/types";

/**
 * Inmobiliaria Naranjo Duque (inmobiliarianaranjoduque.com) — static site built
 * with Incomedia WebSite X5. The whole inventory lives in one file: the e-commerce
 * cart catalog at /cart/x5cart.js (`var x5CartData={...,products:{...}}`), one
 * entry per listing (~86 entries: rentals + sales across Cali/Jamundí/Yumbo/
 * Candelaria). A single GET lists everything; each detail page (/<code>-<slug>.html)
 * only adds the area (m²) and estrato.
 *
 * FRAGILITY NOTE: the catalog is hand-edited by the agency from WebSite X5, so the
 * `properties` labels ("1 TIPO DE BÚSQUEDA", ...) and their values ("Arriendo",
 * "Apartamento") may drift. Every comparison below is normalized (accent/case
 * insensitive) and uses substring matching, never exact equality.
 *
 * The catalog is NOT JSON (unquoted keys, !0/!1 booleans, 12e5 exponents) and it
 * is third-party code: no eval/new Function. We slice per-ficha blocks at the
 * `id_user:"CÓDIGO` boundary and pull each field out with anchored regexes. The
 * `properties:{...}` sub-object IS strict JSON in every ficha, so JSON.parse is
 * safe there. Prices come from the schemaOrg.offers.price string ("1200000"),
 * avoiding the `12e5` exponent notation entirely.
 */

const BASE = "https://www.inmobiliarianaranjoduque.com";
const CATALOG = `${BASE}/cart/x5cart.js`;
const AGENCY = "INMOBILIARIA NARANJO DUQUE";
const PHONE = "3241000095"; // site links api.whatsapp.com/send?phone=573241000095
const WA_NUMBER = "573241000095";

/** One ficha of the cart catalog, already sliced from the raw JS. */
interface Ficha {
  code: string; // "2474"
  description: string; // "ALQUILER ... <br />En: Jamundí<br />...Baños 2"
  barrio: string | null;
  zona: string | null;
  city: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  price: number | null;
  url: string | null;
  properties: Record<string, string>;
}

/** Split the catalog blob into per-ficha chunks at the `id_user:"CÓDIGO` boundary. */
function splitFichas(js: string): string[] {
  const matches = [...js.matchAll(/id_user:"CÓDIGO/g)];
  return matches.map((m, i) => js.slice(m.index, matches[i + 1]?.index ?? js.length));
}

/** Strict-JSON sub-object `properties:{...}` sits right before `schemaOrg:`. */
function parseProperties(block: string): Record<string, string> | null {
  const m = block.match(/properties:(\{.*?\})\s*,\s*schemaOrg/);
  if (!m) return null;
  try {
    return JSON.parse(m[1]) as Record<string, string>;
  } catch {
    return null;
  }
}

function parseFicha(block: string): Ficha | null {
  const code = block.match(/id_user:"CÓDIGO\s*(\d+)/)?.[1] ?? null;
  if (!code) return null;
  const properties = parseProperties(block);
  if (!properties) return null;

  // Double-quoted JS string; tolerates backslash escapes (e.g. `<\/a>`).
  const description = block.match(/description:"((?:[^"\\]|\\.)*)"/)?.[1] ?? "";

  // Price: schemaOrg.offers.price ("1200000"), only when declared in COP.
  const offer = block.match(/"@type":"Offer"[^}]*priceCurrency:"([A-Z]+)",price:"([^"]+)"/);
  const price = offer && offer[1] === "COP" ? parsePriceCOP(offer[2]) : null;

  // Detail URL: the href inside link.html.upload, minus the base-url marker.
  // Slugs can carry a literal double dot ("...colseguros..html") — keep as-is.
  const slug = block.match(/href="<!--base_url_placeholder-->([^"]+?)"/)?.[1] ?? null;

  return {
    code,
    description,
    barrio: properties["5 BARRIO"]?.trim() || null,
    zona: properties["4 ZONA"]?.trim() || null,
    city: properties["3 CIUDAD"]?.trim() || null,
    bedrooms: parseIntSafe(properties["6 ALCOBAS"] ?? null),
    bathrooms: parseIntSafe(description.match(/Baños\s*:?\s*(\d+)/)?.[1] ?? null),
    price,
    url: slug ? absolutize(BASE, slug) : null,
    properties,
  };
}

/** Rental semantics: "Arriendo"/"Alquiler" (normalized substring). */
function isRental(f: Ficha): boolean {
  const v = norm(f.properties["1 TIPO DE BÚSQUEDA"]);
  return v.includes("arriendo") || v.includes("alquiler");
}

/**
 * Property type. "Apartaestudio" counts as apartamento (it is a studio
 * apartment, useful coverage for the same search); non-residential kinds
 * (Local, Local Comercial, Bodega, Lote, Oficina, Finca) fall through.
 */
function isType(f: Ficha, want: ResolvedCrawlParams["propertyType"]): boolean {
  const v = norm(f.properties["2 TIPO DE INMUEBLE"]);
  if (!v) return false;
  if (want === "apartamento") return v.includes("apartamento") || v.includes("apartaestudio");
  return v.includes("casa");
}

/**
 * City from `properties` only — never from the slug: some Jamundí listings are
 * titled "al sur de cali" and one Yumbo listing says "al norte de cali".
 */
function inCities(f: Ficha, cities: string[]): boolean {
  const v = norm(f.city);
  return cities.some((c) => v === norm(c) || v.includes(norm(c)));
}

/** Enrichment bits only present on the detail page (plain WebSite X5 HTML). */
export function parseDetailHtml(html: string): {
  areaM2: number | null;
  estrato: number | null;
  price: number | null;
  adminIncluded: boolean;
} {
  const $ = load(html);
  // Headline ("Apartamentos, Alquiler, Parque Natura - 60m²") lives in an
  // #imTextObject_* block; fall back to the whole body for safety.
  let text = "";
  $("div[id^='imTextObject']").each((_, el) => {
    text += $(el).text() + "\n";
  });
  const bodyText = $("body").text();
  const hay = text || bodyText;

  const areaM2 =
    parseArea(hay.match(/(\d+(?:[.,]\d+)?)\s*m²/)?.[1] ?? null) ??
    parseArea(bodyText.match(/(\d+(?:[.,]\d+)?)\s*m²/)?.[1] ?? null);

  let estrato = parseIntSafe(hay.match(/Estrato:\s*(\d)/)?.[1] ?? null);
  if (estrato != null && (estrato < 1 || estrato > 6)) estrato = null;

  // Label drifts between pages: "Valor: $..." / "Canon: $...".
  const price = parsePriceCOP(hay.match(/(?:Valor|Canon|Precio)\s*:?\s*\$?\s*([\d.,]+)/)?.[1] ?? null);
  // "ADMINISTRACIÓN INCLUIDA" → the rent already bundles the admin fee; there is
  // no separate amount anywhere, so admin stays null (never invent one).
  const adminIncluded = norm(hay).includes("administracion incluida");

  return { areaM2, estrato, price, adminIncluded };
}

function toListing(f: Ficha, detail: ReturnType<typeof parseDetailHtml> | null): Listing | null {
  if (!f.url) return null;
  const barrioRaw = f.barrio ?? f.zona; // "5 BARRIO" with "4 ZONA" as fallback
  return {
    source: "naranjoduque",
    sourceListingId: f.code,
    url: f.url,
    title: f.description.split("<br")[0]?.trim() || null,
    barrio: barrioRaw ? titleCase(barrioRaw) : null,
    conjunto: null,
    city: f.city,
    address: null,
    lat: null, // no coordinates anywhere on this site; pipeline geocodes by barrio
    lng: null,
    geocodePrecision: null,
    areaM2: detail?.areaM2 ?? null,
    bedrooms: f.bedrooms,
    bathrooms: f.bathrooms,
    parking: null,
    price: f.price ?? detail?.price ?? null,
    admin: null,
    estrato: detail?.estrato ?? null,
    currency: "COP",
    agency: AGENCY,
    phone: PHONE,
    hasWhatsapp: true,
    rawJson: JSON.stringify({
      properties: f.properties,
      description: f.description,
      adminIncluded: detail?.adminIncluded ?? null,
      detailPrice: detail?.price ?? null,
      wa: WA_NUMBER,
    }),
  };
}

export const naranjoduqueAdapter: SourceAdapter = {
  id: "naranjoduque",
  label: "Inmobiliaria Naranjo Duque",
  tier: "A",
  domain: "inmobiliarianaranjoduque.com",

  async *fetchList(params: ResolvedCrawlParams, ctx: AdapterContext) {
    const http = new HttpClient();
    let js: string;
    try {
      js = await http.getText(CATALOG);
    } catch (e) {
      ctx.log(`naranjoduque: catalog fetch failed: ${(e as Error).message}`);
      return;
    }

    const all = splitFichas(js)
      .map(parseFicha)
      .filter((f): f is Ficha => !!f);
    const matching = all.filter(
      (f) => isRental(f) && isType(f, params.propertyType) && inCities(f, params.cities),
    );
    ctx.log(
      `naranjoduque: ${all.length} fichas, ${matching.length} ${params.propertyType} rentals in [${params.cities.join(", ")}]`,
    );

    let count = 0;
    for (const f of matching) {
      if (ctx.signal?.aborted) return;
      let detail: ReturnType<typeof parseDetailHtml> | null = null;
      if (f.url) {
        try {
          detail = parseDetailHtml(await http.getText(f.url));
        } catch (e) {
          ctx.log(`naranjoduque: detail failed ${f.url}: ${(e as Error).message}`);
        }
      }
      const listing = toListing(f, detail);
      if (listing) {
        count++;
        yield listing;
      }
    }
    ctx.log(`naranjoduque: yielded ${count}`);
  },

  async fetchDetail(url: string, ctx: AdapterContext): Promise<Partial<Listing> | null> {
    const http = new HttpClient();
    try {
      const html = await http.getText(url);
      const d = parseDetailHtml(html);
      return {
        areaM2: d.areaM2,
        estrato: d.estrato,
        price: d.price,
        admin: null,
        rawJson: JSON.stringify({ adminIncluded: d.adminIncluded, url }),
      };
    } catch (e) {
      ctx.log(`naranjoduque: fetchDetail failed ${url}: ${(e as Error).message}`);
      return null;
    }
  },
};

export default naranjoduqueAdapter;
