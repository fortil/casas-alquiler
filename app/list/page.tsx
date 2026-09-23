"use client";

import { useEffect, useRef, useState } from "react";
import {
  ParamsFields,
  DEFAULT_PARAMS,
  paramsToPayload,
  type ParamValues,
} from "@/components/ParamsFields";
import { ResultsView, type ResultMeta, type ResultPayload } from "@/components/ResultsView";
import { HistoryPanel } from "@/components/HistoryPanel";
import { loadJSON, saveJSON } from "@/lib/clientStore";
import {
  addEntry,
  removeEntry,
  saveHistory,
  HISTORY_KEY,
  type HistoryEntry,
} from "@/lib/searchHistory";

const SAMPLE = `Barrio,Conjunto,Area,Precio,Link
San Fernando,Conjunto Bambú,120,2500000,https://www.fincaraiz.com.co/casa-en-arriendo/...
Pance,Reserva de Pance,95,1900000,
Valle del Lili,Torres del Lili,80,1600000,https://www.ciencuadras.com/inmueble/...`;

interface ListForm {
  params: ParamValues;
  csv: string;
}

const FORM_KEY = "ca_form_list";

export default function ListPage() {
  const [params, setParams] = useState<ParamValues>(DEFAULT_PARAMS);
  const [csv, setCsv] = useState("");
  const [result, setResult] = useState<ResultPayload | null>(null);
  const [resultMeta, setResultMeta] = useState<ResultMeta | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryEntry<ListForm>[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const saved = loadJSON<Partial<ListForm> | null>(FORM_KEY, null);
    const savedDefaults = loadJSON<Partial<ParamValues>>("ca_defaults", {});
    setParams({ ...DEFAULT_PARAMS, ...savedDefaults, ...(saved?.params ?? {}) });
    if (saved?.csv) setCsv(saved.csv);
    const h = loadJSON<HistoryEntry<ListForm>[]>(HISTORY_KEY, []);
    setHistory(h);
    const last = h.find((e) => e.mode === "list");
    if (last) {
      setResult(last.result);
      setResultMeta(last.meta);
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    saveJSON(FORM_KEY, { params, csv } satisfies ListForm);
  }, [hydrated, params, csv]);

  function persistHistory(next: HistoryEntry<ListForm>[]) {
    setHistory(saveHistory(next));
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => setCsv(String(reader.result ?? ""));
    reader.readAsText(f);
  }

  async function evaluate() {
    setLoading(true);
    setError(null);
    try {
      const payload = paramsToPayload(params);
      const res = await fetch("/api/list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, csvText: csv }),
      });
      const data: ResultPayload = await res.json();
      if ((data as { error?: string }).error) throw new Error((data as { error?: string }).error);

      const meta: ResultMeta = {
        cities: [],
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

      const ts = Date.now();
      const entry: HistoryEntry<ListForm> = {
        id: `${ts}-${Math.random().toString(36).slice(2, 7)}`,
        ts,
        sig: `list|${ts}`, // each list evaluation is kept separately
        mode: "list",
        label: `Lista propia · ${data.parsed ?? "?"} filas · ${data.stats?.kept ?? 0} result.`,
        form: { params, csv },
        meta,
        result: data,
      };
      persistHistory(addEntry(history, entry));
    } catch (e) {
      setError(`Evaluación falló: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }

  function restore(e: HistoryEntry<ListForm>) {
    setParams({ ...DEFAULT_PARAMS, ...e.form.params });
    setCsv(e.form.csv);
    setResult(e.result);
    setResultMeta(e.meta);
  }

  const listHistory = history.filter((e) => e.mode === "list");

  return (
    <>
      <h1>Evaluar mi lista</h1>
      <p className="subtitle">
        Pega o sube tu lista (Barrio, Conjunto, Área, Precio, Link) y se rankea con el mismo
        criterio, sin rastrear portales.
      </p>

      <div className="panel">
        <h2>Lista de propiedades</h2>
        <div className="row" style={{ marginBottom: 8 }}>
          <input ref={fileRef} type="file" accept=".csv,text/csv,text/plain" onChange={onFile} />
          <button className="ghost" type="button" onClick={() => setCsv(SAMPLE)}>
            Usar ejemplo
          </button>
        </div>
        <textarea value={csv} onChange={(e) => setCsv(e.target.value)} placeholder={SAMPLE} />
        <div className="hint">
          Encabezados aceptados: Barrio, Conjunto, Area (m²), Precio, Link y opcionalmente Admin,
          Ciudad. Filas sin área ni precio se ignoran. Sin coordenadas, se geocodifica por barrio/
          conjunto (ubicación aproximada).
        </div>
      </div>

      <div className="panel">
        <h2>Parámetros</h2>
        <ParamsFields value={params} onChange={setParams} />
        <div className="row" style={{ marginTop: 16 }}>
          <button onClick={evaluate} disabled={loading || !csv.trim()}>
            {loading ? "Evaluando…" : "Evaluar lista"}
          </button>
        </div>
        {error && <div className="error">{error}</div>}
      </div>

      <HistoryPanel
        entries={listHistory}
        onRestore={restore}
        onDelete={(id) => persistHistory(removeEntry(history, id))}
        onClear={() => persistHistory(history.filter((e) => e.mode !== "list"))}
      />

      {result && resultMeta && <ResultsView result={result} mode="list" meta={resultMeta} />}
    </>
  );
}
