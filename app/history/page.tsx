"use client";

import { useEffect, useState } from "react";
import { loadJSON } from "@/lib/clientStore";
import { removeEntry, saveHistory, HISTORY_KEY, type HistoryEntry } from "@/lib/searchHistory";
import { ResultsView } from "@/components/ResultsView";
import { ParamsSummary } from "@/components/ParamsSummary";

export default function HistoryPage() {
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [selId, setSelId] = useState<string | null>(null);

  useEffect(() => {
    const h = loadJSON<HistoryEntry[]>(HISTORY_KEY, []);
    setHistory(h);
    if (h.length) setSelId(h[0].id);
  }, []);

  const sel = history.find((e) => e.id === selId) ?? null;

  function del(id: string) {
    const next = saveHistory(removeEntry(history, id));
    setHistory(next);
    if (selId === id) setSelId(next[0]?.id ?? null);
  }

  function clearAll() {
    setHistory(saveHistory([]));
    setSelId(null);
  }

  return (
    <>
      <h1>Historial de búsquedas</h1>
      <p className="subtitle">
        Cada búsqueda guardada con sus parámetros y todos sus resultados. Persiste en el navegador
        (sobrevive a reinicios del servidor).
      </p>

      {history.length === 0 ? (
        <div className="panel">
          <p className="muted">
            Aún no hay búsquedas guardadas. Ejecuta una en <strong>Buscar</strong> o{" "}
            <strong>Mi lista</strong> y aparecerá aquí.
          </p>
        </div>
      ) : (
        <div className="history-layout">
          <div className="history-list">
            <div className="row" style={{ marginBottom: 8 }}>
              <strong>{history.length} búsquedas</strong>
              <div className="spacer" />
              <button className="ghost" onClick={clearAll}>
                Borrar todo
              </button>
            </div>
            {history.map((e) => (
              <div
                key={e.id}
                className={`item ${e.id === selId ? "active" : ""}`}
                onClick={() => setSelId(e.id)}
              >
                <div className="row" style={{ gap: 6 }}>
                  <span className={`badge ${e.mode === "scrape" ? "" : "muted"}`}>
                    {e.mode === "scrape" ? "Rastreo" : "Lista"}
                  </span>
                  <div className="spacer" />
                  <button
                    className="ghost"
                    style={{ padding: "2px 8px" }}
                    onClick={(ev) => {
                      ev.stopPropagation();
                      del(e.id);
                    }}
                    title="Eliminar"
                  >
                    ✕
                  </button>
                </div>
                <div className="when">{new Date(e.ts).toLocaleString("es-CO")}</div>
                <div>{e.label}</div>
              </div>
            ))}
          </div>

          <div>
            {sel ? (
              <>
                <div className="panel">
                  <h2>Parámetros usados</h2>
                  <ParamsSummary meta={sel.meta} mode={sel.mode} />
                  <div className="hint" style={{ marginTop: 8 }}>
                    Guardada el {new Date(sel.ts).toLocaleString("es-CO")}.
                  </div>
                </div>
                <ResultsView result={sel.result} meta={sel.meta} mode={sel.mode} />
              </>
            ) : (
              <div className="panel">
                <p className="muted">Selecciona una búsqueda de la lista.</p>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
