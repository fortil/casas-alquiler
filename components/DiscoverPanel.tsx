"use client";

import { useEffect, useState } from "react";
import { CitiesAndTypeFields, type PropertyType } from "@/components/CitiesAndTypeFields";
import { FieldLabel } from "@/components/FieldLabel";
import { loadJSON, saveJSON } from "@/lib/clientStore";
import {
  getDiscoverReview,
  setDiscoverReview,
  mergeCandidates,
  hydrateCandidates,
  DISCOVER_REVIEW_KEY,
  DISCOVER_CANDIDATES_KEY,
  type DiscoverReviewStore,
} from "@/lib/discoverStore";
import { buildAdapterPrompt } from "@/lib/core/discovery/promptTemplate";
import type { CandidateSource } from "@/lib/core/discovery/pipeline";

function relevancePct(c: CandidateSource): string {
  return c.recon ? `${Math.round(c.recon.relevance * 100)}%` : "—";
}

export function DiscoverPanel() {
  const [cities, setCities] = useState<string[]>(["jamundi", "cali"]);
  const [propertyType, setPropertyType] = useState<PropertyType>("casa");
  const [maxQueries, setMaxQueries] = useState("12");
  const [maxCandidates, setMaxCandidates] = useState("20");

  const [candidates, setCandidates] = useState<CandidateSource[]>([]);
  const [reviews, setReviews] = useState<DiscoverReviewStore>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [providerReady, setProviderReady] = useState<boolean | null>(null);
  const [copiedDomain, setCopiedDomain] = useState<string | null>(null);

  useEffect(() => {
    // hydrateCandidates: candidates persisted before `recon.country` existed
    // would otherwise crash the table below.
    setCandidates(hydrateCandidates(loadJSON<CandidateSource[]>(DISCOVER_CANDIDATES_KEY, [])));
    setReviews(loadJSON<DiscoverReviewStore>(DISCOVER_REVIEW_KEY, {}));
  }, []);

  function toggleCity(slug: string) {
    setCities((c) => (c.includes(slug) ? c.filter((x) => x !== slug) : [...c, slug]));
  }

  function persistReviews(next: DiscoverReviewStore) {
    setReviews(next);
    saveJSON(DISCOVER_REVIEW_KEY, next);
  }

  function onReview(domain: string, field: "reviewed" | "prioritized", val: boolean) {
    persistReviews(setDiscoverReview(reviews, domain, { [field]: val }));
  }

  async function runSearch() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/discover-sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cities,
          propertyType,
          maxQueries: parseInt(maxQueries, 10) || 12,
          maxCandidates: parseInt(maxCandidates, 10) || 20,
        }),
      });
      const data = await res.json();
      if (data.error) {
        setProviderReady(false);
        throw new Error(data.error);
      }
      setProviderReady(true);
      const merged = mergeCandidates(candidates, data.candidates ?? []);
      setCandidates(merged);
      saveJSON(DISCOVER_CANDIDATES_KEY, merged);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function copyPrompt(c: CandidateSource) {
    const prompt = buildAdapterPrompt(c);
    try {
      await navigator.clipboard.writeText(prompt);
      setCopiedDomain(c.domain);
      setTimeout(() => setCopiedDomain((d) => (d === c.domain ? null : d)), 2000);
    } catch {
      /* clipboard permission denied — silently ignore, button stays usable */
    }
  }

  const newCandidates = candidates.filter((c) => c.status === "new");
  const evaluated = candidates.filter((c) => c.status !== "new");

  return (
    <div className="panel">
      <h2>Descubrir sitios nuevos</h2>
      <p className="hint" style={{ marginBottom: 12 }}>
        Busca portales inmobiliarios adicionales (más allá de los ya implementados) usando los
        mismos parámetros de ciudad/tipo que la búsqueda principal.
      </p>

      <div className="grid" style={{ marginBottom: 14 }}>
        <CitiesAndTypeFields
          cities={cities}
          onToggleCity={toggleCity}
          propertyType={propertyType}
          onChangePropertyType={setPropertyType}
        />
        <div>
          <FieldLabel tip="Cuántas búsquedas distintas se ejecutan (más ángulos = más cobertura, más costo). Tope 25.">
            Máx. búsquedas
          </FieldLabel>
          <input type="number" min="1" value={maxQueries} onChange={(e) => setMaxQueries(e.target.value)} />
        </div>
        <div>
          <FieldLabel tip="Cuántos dominios nuevos se reconocen (robots.txt, alcanzable, relevancia) por corrida. Tope 50.">
            Máx. candidatos
          </FieldLabel>
          <input
            type="number"
            min="1"
            value={maxCandidates}
            onChange={(e) => setMaxCandidates(e.target.value)}
          />
        </div>
      </div>

      <div className="row">
        <button onClick={runSearch} disabled={loading}>
          {loading ? "Buscando…" : "Buscar sitios nuevos"}
        </button>
        {providerReady === false && (
          <span className="badge warn">
            Configura BRIGHTDATA_SERP_ZONE (y BRIGHTDATA_API_KEY) en .env para usar esta función
          </span>
        )}
      </div>
      {error && <div className="error">{error}</div>}

      {newCandidates.length > 0 && (
        <table style={{ marginTop: 16 }}>
          <thead>
            <tr>
              <th>Dominio</th>
              <th>Relevancia</th>
              <th>País</th>
              <th>robots.txt</th>
              <th>Alcanzable</th>
              <th>Encontrado vía</th>
              <th>Revisión</th>
              <th>Adaptador</th>
            </tr>
          </thead>
          <tbody>
            {newCandidates.map((c) => {
              const rv = getDiscoverReview(reviews, c.domain);
              const cls = rv.prioritized ? "row-eligible" : rv.reviewed ? "row-seen" : "";
              const queries = Array.from(new Set(c.foundVia.map((f) => f.query)));
              const title = `Encontrado vía ${c.foundVia.length} resultado(s):\n${c.foundVia
                .map((f) => `• ${f.query}: ${f.url}`)
                .join("\n")}`;
              const country = c.recon?.country ?? { verdict: "unknown" as const, evidence: [] };
              return (
                <tr key={c.domain} className={cls}>
                  <td>{c.domain}</td>
                  <td>{relevancePct(c)}</td>
                  <td>
                    {!c.recon ? (
                      "—"
                    ) : (
                      <span
                        className={`badge ${country.verdict === "foreign" ? "warn" : country.verdict === "co" ? "good" : "muted"}`}
                        style={{ cursor: "help" }}
                        title={country.evidence.join("\n") || "sin señales"}
                      >
                        {country.verdict === "foreign"
                          ? "✗ fuera de Colombia"
                          : country.verdict === "co"
                            ? "✓ Colombia"
                            : "? indeterminado"}
                      </span>
                    )}
                  </td>
                  <td>
                    {!c.recon ? (
                      "—"
                    ) : !c.recon.robots.fetched ? (
                      <span className="badge muted">sin archivo</span>
                    ) : c.recon.robots.aiBlocked ? (
                      <span className="badge warn" title={c.recon.robots.blockedAgents.join(", ")}>
                        ✗ bloquea IA
                      </span>
                    ) : (
                      <span className="badge good">✓ ok</span>
                    )}
                  </td>
                  <td>{c.recon ? (c.recon.reachable ? "✓" : "✗") : "—"}</td>
                  <td>
                    <span className="badge" title={title} style={{ cursor: "help" }}>
                      {queries.length} búsqueda{queries.length === 1 ? "" : "s"}
                    </span>
                  </td>
                  <td>
                    <div className="rev-cell">
                      <label className="rev">
                        <input
                          type="checkbox"
                          checked={!!rv.reviewed}
                          onChange={(e) => onReview(c.domain, "reviewed", e.target.checked)}
                        />{" "}
                        Revisado
                      </label>
                      <label className="rev">
                        <input
                          type="checkbox"
                          checked={!!rv.prioritized}
                          onChange={(e) => onReview(c.domain, "prioritized", e.target.checked)}
                        />{" "}
                        Priorizado
                      </label>
                    </div>
                  </td>
                  <td>
                    <button
                      className="secondary"
                      disabled={!rv.prioritized}
                      onClick={() => copyPrompt(c)}
                      style={{ whiteSpace: "nowrap" }}
                    >
                      {copiedDomain === c.domain ? "¡Copiado!" : "Copiar prompt"}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {newCandidates.length === 0 && candidates.length > 0 && (
        <p className="hint" style={{ marginTop: 12 }}>
          No hay candidatos nuevos en la última corrida — todos los encontrados ya estaban
          implementados, excluidos, bloqueados o resultaron ser de fuera de Colombia.
        </p>
      )}

      {evaluated.length > 0 && (
        <details style={{ marginTop: 16 }}>
          <summary style={{ cursor: "pointer", fontWeight: 600 }}>
            Ya evaluados ({evaluated.length})
          </summary>
          <table style={{ marginTop: 10 }}>
            <thead>
              <tr>
                <th>Dominio</th>
                <th>Estado</th>
                <th>Motivo</th>
              </tr>
            </thead>
            <tbody>
              {evaluated.map((c) => (
                <tr key={c.domain}>
                  <td>{c.domain}</td>
                  <td>
                    <span className="badge muted">
                      {c.status === "known_implemented"
                        ? "ya implementado"
                        : c.status === "known_excluded"
                          ? "excluido"
                          : c.status === "foreign"
                            ? "fuera de Colombia"
                            : "bloqueado"}
                    </span>
                  </td>
                  <td className="muted">{c.knownReason ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </div>
  );
}
