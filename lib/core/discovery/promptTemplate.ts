import type { CandidateSource } from "@/lib/core/discovery/pipeline";

/**
 * Builds the "copy prompt to build an adapter" text for a prioritized
 * candidate — the hand-off mechanism to an actual Claude Code session, since
 * the running app cannot generate TypeScript source itself.
 */
export function buildAdapterPrompt(candidate: CandidateSource): string {
  const r = candidate.recon;
  const robotsLine = !r
    ? "no verificado (sin reconocimiento)"
    : !r.robots.fetched
      ? "no encontrado / sin restricción detectada"
      : r.robots.aiBlocked
        ? `BLOQUEA crawlers de IA (${r.robots.blockedAgents.join(", ")}) — no continuar sin revisar`
        : "sin bloqueo a IA detectado";

  const queries = Array.from(new Set(candidate.foundVia.map((f) => f.query)));

  // `?? unknown`: candidates persisted before recon.country existed reach this
  // function without the field (localStorage JSON has no types).
  const cv = r?.country ?? { verdict: "unknown" as const, evidence: [] };
  const countryLine =
    !r
      ? "no verificado"
      : cv.verdict === "foreign"
        ? `FUERA de Colombia (${cv.evidence.join("; ")}) — NO construir este adaptador`
        : cv.verdict === "co"
          ? `Colombia (${cv.evidence.join("; ")})`
          : "indeterminado — verificar a mano";

  const lines = [
    "Construye un nuevo SourceAdapter para casas_alquiler.",
    "",
    `SITIO: ${candidate.domain}`,
    "Hallazgos del reconocimiento:",
    `- Alcanzable: ${r ? (r.reachable ? "sí" : "no") : "no verificado"}${r?.statusCode != null ? ` (HTTP ${r.statusCode})` : ""}`,
    `- robots.txt: ${robotsLine}`,
    `- Señales anti-bot: ${r && r.antiBot.signals.length ? r.antiBot.signals.join(", ") : "ninguna detectada"}`,
    `- JSON-LD presente: ${r ? (r.hasJsonLd ? "sí" : "no") : "no verificado"}`,
    `- Relevancia (heurística, verificar a mano): ${r ? r.relevance.toFixed(2) : "n/d"}`,
    `- País: ${countryLine}`,
    `- Encontrado vía: ${queries.length ? queries.join("; ") : "n/d"}`,
    "",
    "CONTRATO:",
    '- Implementa lib/adapters/<id>.ts exportando un SourceAdapter (ver lib/adapters/types.ts):',
    "  { id, label, tier: \"A\"|\"B\"|\"C\", domain, fetchList(params, ctx): AsyncIterable<Listing>, fetchDetail?(url, ctx) }",
    "- Normaliza la salida al esquema Listing de lib/core/schema.ts (source, sourceListingId, url,",
    "  barrio, city, areaM2, bedrooms, price, agency, phone, hasWhatsapp, ...).",
    "- Usa lib/adapters/base/httpClient.ts (HttpClient) + lib/adapters/base/parse.ts (load/",
    "  extractJsonLd/extractNextData/absolutize/extractSitemapLocs) — no reinventes fetch/cheerio.",
    "- Sigue como referencia un adaptador existente (p.ej. lib/adapters/inmoalfaguara.ts para sitios",
    "  con sitemap+JSON-LD, o lib/adapters/bienco.ts para una API JSON interna).",
    "- Registra el adaptador en lib/adapters/index.ts (ALL_ADAPTERS) con domain: \"" + candidate.domain + "\".",
    "- Respeta robots.txt y el throttling de REQUEST_DELAY_MS (~1.1s) — ya lo aplica HttpClient.",
  ];

  return lines.join("\n");
}
