/**
 * Pure domain classification for site discovery: turns a raw search-result URL
 * into a root domain, and classifies it against what we already know (adapters
 * already implemented, sites explicitly excluded, generic non-portal domains).
 */

export type ExclusionReason =
  | "known_implemented"
  | "known_excluded"
  | "blocklisted"
  | "foreign";

/** Sites explicitly excluded from this project, with the documented reason (see README). */
export const EXCLUDED_DOMAINS: Record<string, string> = {
  "mercadolibre.com.co": "robots.txt prohíbe crawlers de IA",
  "puntopropiedad.com": "robots.txt prohíbe crawlers de IA",
  "habi.co": "solo venta, sin arriendos",
  "portalinmobiliario.com": "portal de MercadoLibre Chile, precios en CLP/UF",
  "mfserviciosinmobiliarios.com": "inmobiliaria de Guadalajara, México, precios en MXN",
};

/**
 * ccTLD suffixes that mark a site as clearly NOT Colombian, with the country
 * for the exclusion note. Deliberately a BLACKLIST, not an allowlist: adapters
 * exist on .com (metrocuadrado.com), .co, .com.co and even rentola.co.com, so
 * requiring a Colombian TLD would break discovery. Also deliberately
 * non-exhaustive (no .hn/.ni/.sv/.pr/.cu...) — the content-based country
 * verdict in recon.ts is the backstop, not a longer list.
 */
const FOREIGN_CCTLDS: Record<string, string> = {
  mx: "México",
  cl: "Chile",
  ar: "Argentina",
  pe: "Perú",
  ec: "Ecuador",
  es: "España",
  br: "Brasil",
  uy: "Uruguay",
  py: "Paraguay",
  bo: "Bolivia",
  ve: "Venezuela",
  cr: "Costa Rica",
  pa: "Panamá",
  do: "República Dominicana",
  gt: "Guatemala",
};

/** Generic domains that are never a rental portal worth reconning. */
export const NON_PORTAL_BLOCKLIST: string[] = [
  "facebook.com",
  "instagram.com",
  "youtube.com",
  "twitter.com",
  "x.com",
  "tiktok.com",
  "linkedin.com",
  "wikipedia.org",
  "google.com",
  "maps.google.com",
  "play.google.com",
  "apps.apple.com",
  "pinterest.com",
  "pinterest.com.co",
  "yellowpages.com",
  "paginasamarillas.com.co",
];

/**
 * Extract the root domain (host without scheme/www/port/path/query/fragment)
 * from a URL. Returns null when the input is not a parseable absolute URL.
 */
export function rootDomain(url: string): string | null {
  try {
    const u = new URL(url);
    return u.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** True when `domain` is `base` itself or a subdomain of it. */
function isSameOrSubdomain(domain: string, base: string): boolean {
  return domain === base || domain.endsWith(`.${base}`);
}

/**
 * Classify a domain against known-implemented adapters, known exclusions,
 * generic blocklists, and clearly-foreign ccTLDs. Subdomains of a known/
 * excluded/blocklisted/foreign root classify the same as their root (e.g.
 * "m.facebook.com" -> blocklisted). Returns null for a genuinely novel domain
 * worth reconning.
 */
export function classifyDomain(
  domain: string,
  implementedDomains: Iterable<string>,
): { reason: ExclusionReason; note?: string } | null {
  const d = domain.toLowerCase().replace(/^www\./, "");

  for (const impl of implementedDomains) {
    if (isSameOrSubdomain(d, impl.toLowerCase())) {
      return { reason: "known_implemented" };
    }
  }
  for (const [excluded, note] of Object.entries(EXCLUDED_DOMAINS)) {
    if (isSameOrSubdomain(d, excluded)) {
      return { reason: "known_excluded", note };
    }
  }
  for (const blocked of NON_PORTAL_BLOCKLIST) {
    if (isSameOrSubdomain(d, blocked)) {
      return { reason: "blocklisted" };
    }
  }
  // Suffix match on the whole host, which also covers second-level ccTLDs
  // (".com.mx" ends with ".mx"). Checked last so an explicitly known or
  // excluded domain always wins over its TLD.
  for (const [tld, country] of Object.entries(FOREIGN_CCTLDS)) {
    if (d === tld || d.endsWith(`.${tld}`)) {
      return { reason: "foreign", note: `TLD .${tld} (${country})` };
    }
  }
  return null;
}

export interface Mentioned<T> {
  domain: string;
  items: T[];
}

/**
 * Group a list of {url,...} items by their root domain, preserving all
 * original items per domain (used to merge `foundVia` entries for duplicates).
 * Items whose URL doesn't parse are silently dropped.
 */
export function dedupeByDomain<T extends { url: string }>(items: T[]): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const item of items) {
    const d = rootDomain(item.url);
    if (!d) continue;
    const arr = out.get(d);
    if (arr) arr.push(item);
    else out.set(d, [item]);
  }
  return out;
}
