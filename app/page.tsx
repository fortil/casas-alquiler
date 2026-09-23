"use client";

import { useEffect, useState } from "react";
import {
  ParamsFields,
  DEFAULT_PARAMS,
  paramsToPayload,
  type ParamValues,
} from "@/components/ParamsFields";
import { ResultsView, type ResultMeta, type ResultPayload } from "@/components/ResultsView";
import { FieldLabel, Tip } from "@/components/FieldLabel";
import { HistoryPanel } from "@/components/HistoryPanel";
import { CitiesAndTypeFields } from "@/components/CitiesAndTypeFields";
import { loadJSON, saveJSON } from "@/lib/clientStore";
import {
  addEntry,
  removeEntry,
  saveHistory,
  HISTORY_KEY,
  type HistoryEntry,
} from "@/lib/searchHistory";

interface SearchForm {
  params: ParamValues;
  cities: string[];
  propertyType: "casa" | "apartamento";
  southernCaliOnly: boolean;
  includeHard: boolean;
  useBrightData: boolean;
  maxPerSource: string;
}

const FORM_KEY = "ca_form_search";

export default function SearchPage() {
  const [params, setParams] = useState<ParamValues>(DEFAULT_PARAMS);
  const [cities, setCities] = useState<string[]>(["jamundi", "cali"]);
  const [propertyType, setPropertyType] = useState<"casa" | "apartamento">("casa");
  const [southernCaliOnly, setSouthernCaliOnly] = useState(false);
  const [includeHard, setIncludeHard] = useState(false);
  const [useBrightData, setUseBrightData] = useState(false);
  const [maxPerSource, setMaxPerSource] = useState("0");

  const [result, setResult] = useState<ResultPayload | null>(null);
  const [resultMeta, setResultMeta] = useState<ResultMeta | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshMsg, setRefreshMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryEntry<SearchForm>[]>([]);

  const [hydrated, setHydrated] = useState(false);

  // --- Hydrate form + history from localStorage (survives server restart) ---
  useEffect(() => {
    const savedForm = loadJSON<Partial<SearchForm> | null>(FORM_KEY, null);
    const savedDefaults = loadJSON<Partial<ParamValues>>("ca_defaults", {});
    setParams({ ...DEFAULT_PARAMS, ...savedDefaults, ...(savedForm?.params ?? {}) });
    if (savedForm) {
      if (savedForm.cities) setCities(savedForm.cities);
      if (savedForm.propertyType) setPropertyType(savedForm.propertyType);
      if (typeof savedForm.southernCaliOnly === "boolean") setSouthernCaliOnly(savedForm.southernCaliOnly);
      if (typeof savedForm.includeHard === "boolean") setIncludeHard(savedForm.includeHard);
      if (typeof savedForm.useBrightData === "boolean") setUseBrightData(savedForm.useBrightData);
      if (savedForm.maxPerSource) setMaxPerSource(savedForm.maxPerSource);
    }
    setHistory(loadJSON<HistoryEntry<SearchForm>[]>(HISTORY_KEY, []));
    // restore the most recent scrape result so the page isn't empty after a reload
    const last = loadJSON<HistoryEntry<SearchForm>[]>(HISTORY_KEY, []).find((e) => e.mode === "scrape");
    if (last) {
      setResult(last.result);
      setResultMeta(last.meta);
    }
    setHydrated(true);
  }, []);

  // --- Persist the form whenever it changes (only AFTER hydration, so the
  //     restored values are never clobbered by the initial defaults) ---
  useEffect(() => {
    if (!hydrated) return;
    const form: SearchForm = { params, cities, propertyType, southernCaliOnly, includeHard, useBrightData, maxPerSource };
    saveJSON(FORM_KEY, form);
  }, [hydrated, params, cities, propertyType, southernCaliOnly, includeHard, useBrightData, maxPerSource]);

  function persistHistory(next: HistoryEntry<SearchForm>[]) {
    setHistory(saveHistory(next));
  }

  function toggleCity(slug: string) {
    setCities((c) => (c.includes(slug) ? c.filter((x) => x !== slug) : [...c, slug]));
  }

  async function refresh() {
    setRefreshing(true);
    setRefreshMsg(null);
    setError(null);
    try {
      const res = await fetch("/api/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cities,
          propertyType,
          includeHardSources: includeHard,
          maxPagesPerSource: 20,
          maxPerSource: parseInt(maxPerSource, 10) || 0,
          geocode: true,
          useBrightData,
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      const by = Object.entries(data.bySource ?? {})
        .map(([k, v]) => `${k}:${v}`)
        .join("  ");
      const warn = data.warnings?.length ? ` · ⚠ ${data.warnings.join("; ")}` : "";
      const errs = data.errors?.length ? ` · ⚠ ${data.errors.length} errores por fuente (ver servidor)` : "";
      setRefreshMsg(
        `Rastreo listo: ${data.persisted}/${data.total} guardadas · ${by} · ${data.deactivated} dadas de baja${warn}${errs}`,
      );
    } catch (e) {
      setError(`Refrescar falló: ${(e as Error).message}`);
    } finally {
      setRefreshing(false);
    }
  }

  async function search() {
    setLoading(true);
    setError(null);
    try {
      const payload = paramsToPayload(params);
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, cities, southernCaliOnly }),
      });
      const data: ResultPayload = await res.json();
      if ((data as { error?: string }).error) throw new Error((data as { error?: string }).error);

      const meta: ResultMeta = {
        cities,
        refPoint: payload.refPoint,
        refLabel: payload.refLabel,
        refCoordsSource: payload.refCoordsSource,
        maxDistKm: payload.maxDistKm,
        minAreaM2: payload.minAreaM2,
        minBedrooms: payload.minBedrooms,
        minPrice: payload.minPrice,
        maxPrice: payload.maxPrice,
        weights: payload.weights,
        distanceMode: payload.distanceMode,
      };
      setResult(data);
      setResultMeta(meta);

      const sig = `scrape|${cities.join(",")}|${propertyType}|${payload.maxDistKm}|${payload.minAreaM2}|${payload.minBedrooms}|${payload.minPrice}|${payload.maxPrice}|${southernCaliOnly}`;
      const ts = Date.now();
      const label = `${cities.join("+")} · ≤${payload.maxDistKm}km · ≥${payload.minAreaM2}m²${
        payload.minBedrooms ? ` · ≥${payload.minBedrooms}hab` : ""
      } · ${data.stats?.kept ?? 0} result.`;
      const entry: HistoryEntry<SearchForm> = {
        id: `${ts}-${Math.random().toString(36).slice(2, 7)}`,
        ts,
        sig,
        mode: "scrape",
        label,
        form: { params, cities, propertyType, southernCaliOnly, includeHard, useBrightData, maxPerSource },
        meta,
        result: data,
      };
      persistHistory(addEntry(history, entry));
    } catch (e) {
      setError(`Búsqueda falló: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }

  function restore(e: HistoryEntry<SearchForm>) {
    const f = e.form;
    setParams({ ...DEFAULT_PARAMS, ...f.params });
    setCities(f.cities);
    setPropertyType(f.propertyType);
    setSouthernCaliOnly(f.southernCaliOnly);
    setIncludeHard(f.includeHard);
    setUseBrightData(f.useBrightData ?? false);
    setMaxPerSource(f.maxPerSource);
    setResult(e.result);
    setResultMeta(e.meta);
  }

  const scrapeHistory = history.filter((e) => e.mode === "scrape");

  return (
    <>
      <h1>Buscar casas en alquiler</h1>
      <p className="subtitle">
        Jamundí y sur de Cali · ranking por mejor valor para inquilino (más m² por menos plata).
      </p>

      <div className="panel">
        <h2>Parámetros</h2>
        <div className="grid" style={{ marginBottom: 14 }}>
          <CitiesAndTypeFields
            cities={cities}
            onToggleCity={toggleCity}
            propertyType={propertyType}
            onChangePropertyType={setPropertyType}
          />
          <div>
            <label>Zona</label>
            <div className="checkbox-row">
              <input
                type="checkbox"
                id="south"
                checked={southernCaliOnly}
                onChange={(e) => setSouthernCaliOnly(e.target.checked)}
              />
              <label htmlFor="south">Solo sur de Cali</label>
              <Tip text="Restringe los resultados de Cali a los barrios del sur configurados en Configuración." />
            </div>
            <div className="checkbox-row">
              <input
                type="checkbox"
                id="hard"
                checked={includeHard}
                onChange={(e) => setIncludeHard(e.target.checked)}
              />
              <label htmlFor="hard">Incluir Metrocuadrado</label>
              <Tip text="Incluye el portal Metrocuadrado al rastrear. Requiere Bright Data por su anti-bot (si no está configurado, se omite)." />
            </div>
            <div className="checkbox-row">
              <input
                type="checkbox"
                id="bdEgress"
                checked={useBrightData}
                onChange={(e) => setUseBrightData(e.target.checked)}
              />
              <label htmlFor="bdEgress">Rastrear con IP remota (Bright Data)</label>
              <Tip text="Rastrea todos los portales con la IP remota de Bright Data en vez de tu IP local. Úsalo si tu IP está bloqueada o baneada por los portales. Requiere BRIGHTDATA_BROWSER_WS o BRIGHTDATA_API_KEY en .env; si no hay configuración, avisa y usa la IP local." />
            </div>
          </div>
          <div>
            <FieldLabel tip="Limita cuántos avisos se traen de cada portal al refrescar. 0 = sin límite. Los portales devuelven primero sus avisos más relevantes/recientes.">
              Máx. resultados por portal
            </FieldLabel>
            <input
              type="number"
              min="0"
              value={maxPerSource}
              onChange={(e) => setMaxPerSource(e.target.value)}
            />
            <div className="hint">0 = sin límite. Trae los primeros N de cada portal al refrescar.</div>
          </div>
        </div>

        <ParamsFields value={params} onChange={setParams} />

        <div className="row" style={{ marginTop: 16 }}>
          <button className="secondary" onClick={refresh} disabled={refreshing || loading}>
            {refreshing ? "Rastreando portales…" : "1. Refrescar datos"}
          </button>
          <button onClick={search} disabled={loading || refreshing}>
            {loading ? "Buscando…" : "2. Buscar"}
          </button>
          <div className="spacer" />
          <span className="hint">
            Refresca para rastrear los portales; luego busca/filtra sobre lo guardado.
          </span>
        </div>
        {refreshMsg && <div className="hint" style={{ marginTop: 8 }}>{refreshMsg}</div>}
        {error && <div className="error">{error}</div>}
      </div>

      <HistoryPanel
        entries={scrapeHistory}
        onRestore={restore}
        onDelete={(id) => persistHistory(removeEntry(history, id))}
        onClear={() => persistHistory(history.filter((e) => e.mode !== "scrape"))}
      />

      {result && resultMeta && <ResultsView result={result} mode="scrape" meta={resultMeta} />}
    </>
  );
}
