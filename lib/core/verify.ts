import { BROWSER_HEADERS } from "@/lib/config";
import { norm } from "@/lib/util/text";

export interface VerifyResult {
  isActive: boolean;
  reason: string;
  status?: number;
  finalUrl?: string;
}

/** Phrases that indicate a listing was rented/removed/expired. */
const DEAD_MARKERS = [
  "ya fue arrendado",
  "ya fue rentado",
  "propiedad arrendada",
  "inmueble arrendado",
  "no disponible",
  "ya no esta disponible",
  "ya no se encuentra disponible",
  "propiedad no encontrada",
  "inmueble no encontrado",
  "aviso no disponible",
  "publicacion finalizada",
  "este inmueble no esta disponible",
  "este inmueble ya no se encuentra",
  "publicacion no disponible",
  "el inmueble que buscas no",
  "error-404",
  "pagina no encontrada",
  "404 not found",
];

/** Path fragments that mean we were redirected to a search/index, not a detail. */
const REDIRECT_TO_SEARCH = ["/arriendo", "/buscar", "/search", "/s/", "error-404", "/404"];

/**
 * Verify a listing URL is still a live, available detail page.
 * Heuristic and resilient: network errors are treated as "active" (do not
 * drop a listing just because a single fetch hiccuped) unless the server
 * clearly says 404/410.
 *
 * Reliability note: this catches hard 404/410, redirects to a search/home
 * page, and explicit "arrendado / no disponible" text on server-rendered
 * portals. It CANNOT detect a soft-404 on pure-SPA detail pages (e.g.
 * Ciencuadras returns HTTP 200 with a client-rendered "not found" shell).
 * Those are covered by the authoritative availability signal — the crawl
 * diff in orchestrator.ts marks any listing absent from a source's current
 * pages as inactive. verifyUrl is a best-effort secondary guard for the
 * moment results are presented. We deliberately avoid size/structured-data
 * heuristics here because a false "inactive" (dropping a live listing) is
 * worse than a missed soft-404.
 */
export async function verifyUrl(url: string): Promise<VerifyResult> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch(url, {
      headers: BROWSER_HEADERS,
      redirect: "follow",
      signal: controller.signal,
    });
    const finalUrl = res.url || url;

    if (res.status === 404 || res.status === 410) {
      return { isActive: false, reason: `HTTP ${res.status}`, status: res.status, finalUrl };
    }

    // Redirected away from the detail path to a search/index page.
    if (redirectedToSearch(url, finalUrl)) {
      return { isActive: false, reason: "redirected to search/index", status: res.status, finalUrl };
    }

    if (res.status >= 500) {
      // Server error: don't penalize the listing, recheck later.
      return { isActive: true, reason: `server ${res.status} (kept)`, status: res.status, finalUrl };
    }

    const body = norm(await res.text());
    const marker = DEAD_MARKERS.find((m) => body.includes(m));
    if (marker) {
      return { isActive: false, reason: `marker: "${marker}"`, status: res.status, finalUrl };
    }

    return { isActive: true, reason: "ok", status: res.status, finalUrl };
  } catch (e) {
    // Network/timeout: keep active (transient), note the reason.
    return { isActive: true, reason: `fetch error (kept): ${(e as Error).message}` };
  } finally {
    clearTimeout(t);
  }
}

function redirectedToSearch(original: string, finalUrl: string): boolean {
  if (finalUrl === original) return false;
  let finalPath: string;
  try {
    finalPath = new URL(finalUrl).pathname.toLowerCase();
  } catch {
    return false;
  }
  if (finalPath === "/" || finalPath === "") return true;
  return REDIRECT_TO_SEARCH.some((frag) => finalPath.includes(frag));
}

/** Verify many URLs with bounded concurrency. */
export async function verifyMany(
  urls: string[],
  concurrency = 6,
): Promise<Map<string, VerifyResult>> {
  const out = new Map<string, VerifyResult>();
  let i = 0;
  async function worker() {
    while (i < urls.length) {
      const idx = i++;
      const url = urls[idx];
      out.set(url, await verifyUrl(url));
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, urls.length) }, worker));
  return out;
}
