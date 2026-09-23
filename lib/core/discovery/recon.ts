import { HttpClient } from "@/lib/adapters/base/httpClient";
import { load, extractJsonLd } from "@/lib/adapters/base/parse";
import { norm } from "@/lib/util/text";

/**
 * Lightweight, best-effort viability recon for a candidate domain discovered
 * via search. This is a TRIAGE tool, not a guarantee:
 *  - the robots.txt parser is a heuristic full-site-ban matcher, not a spec-
 *    complete parser (no `Allow:` precedence, no wildcard path matching);
 *  - relevanceScore reads raw HTML text, not a rendered DOM, so JS-heavy SPA
 *    sites will under-score even when they do list rentals;
 *  - the anti-bot sniff is presence-only (a hint), never a classifier;
 *  - absence of a robots.txt file means "no ban found", not "verified safe.";
 *  - the country verdict is a conservative two-signal heuristic (see
 *    detectCountry): "unknown" means a person decides, not "Colombian".
 */

export interface RobotsCheck {
  fetched: boolean;
  aiBlocked: boolean;
  blockedAgents: string[];
}

const AI_AGENT_NAMES = ["claudebot", "anthropic-ai", "gptbot", "ccbot", "google-extended", "*"];

/**
 * Detect a full-site ban (`Disallow: /` with nothing after the slash) under a
 * User-agent block naming a known AI-crawler (or the wildcard `*`). Partial
 * path bans (`Disallow: /privado/`) do NOT count as a block.
 */
export function analyzeRobotsTxt(text: string | null): RobotsCheck {
  if (text == null || text.trim() === "") {
    return { fetched: false, aiBlocked: false, blockedAgents: [] };
  }

  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const blockedAgents: string[] = [];
  let currentAgents: string[] = [];
  let prevWasUserAgent = false;

  for (const line of lines) {
    if (line === "" || line.startsWith("#")) continue;
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const [, field, rawValue] = m;
    const value = rawValue.trim();
    const key = field.toLowerCase();

    if (key === "user-agent") {
      // A User-agent line right after another User-agent line continues the
      // same block (multiple agents sharing directives); anything else
      // (a Disallow/Allow/etc. in between, or the very first line) starts a
      // fresh block.
      currentAgents = prevWasUserAgent ? [...currentAgents, value.toLowerCase()] : [value.toLowerCase()];
      prevWasUserAgent = true;
    } else {
      prevWasUserAgent = false;
      if (key === "disallow" && value === "/") {
        for (const agent of currentAgents) {
          if (AI_AGENT_NAMES.includes(agent)) blockedAgents.push(agent);
        }
      }
    }
  }

  return {
    fetched: true,
    aiBlocked: blockedAgents.length > 0,
    blockedAgents: Array.from(new Set(blockedAgents)),
  };
}

export interface AntiBotHint {
  hinted: boolean;
  signals: string[];
}

const ANTI_BOT_HEADER_HINTS: { header: string; match?: RegExp; label: string }[] = [
  { header: "cf-ray", label: "Cloudflare (cf-ray)" },
  { header: "server", match: /incapsula/i, label: "Imperva Incapsula" },
  { header: "server", match: /cloudflare/i, label: "Cloudflare (server)" },
  { header: "x-akamai-transformed", label: "Akamai" },
];

const ANTI_BOT_BODY_HINTS: { re: RegExp; label: string }[] = [
  { re: /just a moment/i, label: "Cloudflare challenge page" },
  { re: /checking your browser/i, label: "browser-check challenge" },
  { re: /captcha/i, label: "CAPTCHA mention" },
];

/** Presence-only anti-bot signal sniff (never auto-excludes a candidate). */
export function detectAntiBotHints(headers: Record<string, string>, bodySample: string): AntiBotHint {
  const signals: string[] = [];
  const lowerHeaders: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) lowerHeaders[k.toLowerCase()] = v;

  for (const hint of ANTI_BOT_HEADER_HINTS) {
    const v = lowerHeaders[hint.header];
    if (v == null) continue;
    if (!hint.match || hint.match.test(v)) signals.push(hint.label);
  }
  const sample = (bodySample ?? "").slice(0, 5000);
  for (const hint of ANTI_BOT_BODY_HINTS) {
    if (hint.re.test(sample)) signals.push(hint.label);
  }
  return { hinted: signals.length > 0, signals: Array.from(new Set(signals)) };
}

const RELEVANCE_KEYWORDS = ["arriendo", "alquiler", "inmobiliaria", "arrendar", "canon"];

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Heuristic 0..1 relevance score: word-boundary keyword density of rental-related
 * terms and target-city mentions over the raw HTML ("calidad"/"localidad" do NOT
 * count as "cali" mentions). Bounded for empty/tiny pages. Matching happens on
 * `norm()`-ed text (lowercase, diacritics stripped), which is exactly what makes
 * ASCII \b safe here.
 */
export function relevanceScore(html: string, cities: string[]): number {
  const text = norm(html);
  if (!text || text.length < 20) return 0;

  const words = text.split(/\s+/).filter(Boolean);
  const wordCount = Math.max(words.length, 1);

  let hits = 0;
  for (const kw of RELEVANCE_KEYWORDS) {
    const re = new RegExp(`\\b${escapeRegExp(kw)}\\b`, "g");
    hits += (text.match(re) ?? []).length;
  }
  for (const city of cities) {
    const c = norm(city);
    if (!c) continue;
    const re = new RegExp(`\\b${escapeRegExp(c)}\\b`, "g");
    hits += (text.match(re) ?? []).length;
  }

  // Density relative to page length, scaled so a handful of hits on a normal
  // homepage already reads as clearly relevant, capped at 1.
  const density = hits / Math.sqrt(wordCount);
  return Math.max(0, Math.min(1, density / 3));
}

export interface CountryVerdict {
  verdict: "co" | "foreign" | "unknown";
  evidence: string[];
}

/**
 * Strongly-Colombian signals, matched on norm()-ed home HTML. "Estrato" and
 * "NIT" are the cheapest and most reliable ones — "arriendo" is useless here
 * (Chile uses it too). Currencies only count glued to an amount, never as a
 * bare code: shopping-cart widgets list every currency code ("ALL", "USD",
 * "MXN", "CLP"...), so a bare "MXN" would flag Colombian sites as Mexican.
 */
const CO_SIGNALS: { label: string; re: RegExp }[] = [
  { label: "estrato", re: /\bestratos?\b/ },
  { label: "NIT", re: /\bnit\b/ },
  { label: "cánon de arrendamiento", re: /\bcanon de arrendamiento\b/ },
  { label: "COP pegado a un importe", re: /\d[\d.,]*\s?cop\b|\bcop\s?\d[\d.,]*/ },
  { label: "Valle del Cauca", re: /\bvalle del cauca\b/ },
  { label: "Jamundí", re: /\bjamundi\b/ },
  // At least two digits after +57, so a country-selector widget ("Colombia
  // (+57)") — which lists every prefix — never fires this.
  { label: "teléfono +57", re: /\+57\s?\(?\d{2}|\+57\s?\(\d\)\s?\d/ },
  { label: "administración junto a un precio", re: /administracion[^\n]{0,40}?\d{4,}/ },
];

/** Foreign currency patterns, all requiring the currency glued to an amount. */
const FOREIGN_CURRENCIES: { re: RegExp; country: string }[] = [
  { re: /\d[\d.,]*\s?mxn\b|\bmxn\s?\$?\s?\d/, country: "mx" }, // "$18,000 MXN"
  { re: /\buf\s?\d[\d.,]*\b|\d[\d.,]*\s?uf\b/, country: "cl" }, // "UF 3.500" / "3.500 UF"
  { re: /\bclp\$?\s?\d|\d[\d.,]*\s?clp\b/, country: "cl" }, // "CLP$ 80.000" / "80.000 CLP"
  { re: /\bs\/\.?\s?\d/, country: "pe" }, // "S/ 800"
  { re: /\d[\d.,]*\s?€|€\s?\d[\d.,]*/, country: "es" },
];

/**
 * Toponyms that mark a listing as not-Colombian, with the country they point
 * to, matched on norm()-ed text ("Ñuñoa" -> "nunoa"). "santiago" excludes
 * "Santiago de Cali", the full name of Cali itself.
 */
const FOREIGN_TOPONYMS: { toponym: string; country: string }[] = [
  { toponym: "jalisco", country: "mx" },
  { toponym: "guadalajara", country: "mx" },
  { toponym: "cdmx", country: "mx" },
  { toponym: "monterrey", country: "mx" },
  { toponym: "santiago", country: "cl" },
  { toponym: "las condes", country: "cl" },
  { toponym: "providencia", country: "cl" },
  { toponym: "nunoa", country: "cl" },
  { toponym: "buenos aires", country: "ar" },
  { toponym: "lima", country: "pe" },
];

function toponymRegex(toponym: string): RegExp {
  if (toponym === "santiago") return /\bsantiago\b(?!\s+de\s+cali)/;
  return new RegExp(`\\b${escapeRegExp(toponym)}\\b`);
}

/**
 * Pure country heuristic over a site's home HTML. Foreign requires TWO
 * concordant signals — same foreign country (a Mexican price AND a Mexican
 * city), not two unrelated ones: toponyms from different countries are the
 * signature of a Colombian aggregator showing international inventory (seen
 * live on apartamento.com.co), not of a foreign site. And any Colombian
 * signal alongside foreign ones means "mixed" -> unknown, a person decides.
 */
export function detectCountry(html: string): CountryVerdict {
  const text = norm(html);
  if (!text) return { verdict: "unknown", evidence: [] };

  const co: string[] = [];
  const foreignByCountry = new Map<string, string[]>();

  const addForeign = (country: string, evidence: string) => {
    const arr = foreignByCountry.get(country) ?? [];
    arr.push(evidence);
    foreignByCountry.set(country, arr);
  };

  for (const { re, country } of FOREIGN_CURRENCIES) {
    const m = text.match(re);
    if (m) addForeign(country, `moneda extranjera: "${m[0].trim()}"`);
  }
  for (const { toponym, country } of FOREIGN_TOPONYMS) {
    const m = text.match(toponymRegex(toponym));
    if (m) addForeign(country, `topónimo: "${m[0]}"`);
  }
  for (const sig of CO_SIGNALS) {
    const m = text.match(sig.re);
    if (m) co.push(`señal CO: ${sig.label}`);
  }

  const dedupe = (arr: string[]) => Array.from(new Set(arr)).slice(0, 6);
  const foreignAll = Array.from(foreignByCountry.values()).flat();
  const maxConcordant = Math.max(0, ...Array.from(foreignByCountry.values(), (v) => v.length));

  if (co.length === 0 && maxConcordant >= 2) {
    return { verdict: "foreign", evidence: dedupe(foreignAll) };
  }
  if (co.length >= 1 && foreignAll.length === 0) {
    return { verdict: "co", evidence: dedupe(co) };
  }
  return { verdict: "unknown", evidence: dedupe([...foreignAll, ...co]) };
}

export interface CandidateRecon {
  reachable: boolean;
  statusCode: number | null;
  robots: RobotsCheck;
  antiBot: AntiBotHint;
  relevance: number;
  hasJsonLd: boolean;
  country: CountryVerdict;
  error?: string;
}

/** Run the full lightweight recon for one candidate domain. Never throws. */
export async function reconDomain(
  domain: string,
  opts: { cities?: string[]; timeoutMs?: number; client?: HttpClient } = {},
): Promise<CandidateRecon> {
  const client = opts.client ?? new HttpClient();
  const timeoutMs = opts.timeoutMs ?? 8000;
  const base = `https://${domain}`;

  const robotsRes = await client.getRaw(`${base}/robots.txt`, { timeoutMs, delayMs: 0 });
  const robots = analyzeRobotsTxt(robotsRes.ok ? robotsRes.body : null);

  const homeRes = await client.getRaw(base, { timeoutMs, delayMs: 0 });
  const body = homeRes.body ?? "";

  let hasJsonLd = false;
  try {
    if (body) hasJsonLd = extractJsonLd(load(body)).length > 0;
  } catch {
    hasJsonLd = false;
  }

  return {
    reachable: homeRes.ok,
    statusCode: homeRes.status,
    robots,
    antiBot: detectAntiBotHints(homeRes.headers, body),
    relevance: body ? relevanceScore(body, opts.cities ?? []) : 0,
    hasJsonLd,
    country: body ? detectCountry(body) : { verdict: "unknown", evidence: [] },
    error: homeRes.error,
  };
}
