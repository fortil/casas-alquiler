"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { loadJSON, saveJSON } from "@/lib/clientStore";
import { HISTORY_KEY, type HistoryEntry } from "@/lib/searchHistory";
import {
  getReview,
  setReview,
  REVIEW_KEY,
  type ReviewState,
  type ReviewStore,
} from "@/lib/reviewStore";
import {
  collectMarked,
  filterByState,
  stateCounts,
  toExportRow,
  type MarkedHouse,
  type ReviewLabel,
} from "@/lib/markedHouses";
import type { ScoredListing } from "@/lib/core/schema";
import { ColumnPicker } from "@/components/ColumnPicker";
import { RESULT_COLUMNS, type RenderCtx } from "@/components/resultColumns";

const STATES: { key: ReviewLabel; label: string }[] = [
  { key: "eligible", label: "Elegible" },
  { key: "seen", label: "Vista" },
  { key: "none", label: "Sin estado" },
];

const COLS_KEY = "ca_marked_columns";

interface MCol {
  key: string;
  label: string;
  render: (m: MarkedHouse, ctx: RenderCtx) => ReactNode;
}

// Same columns as the results table (rendered from the listing) + a marked-only
// "Estado" column, so the two never diverge.
const MARKED_COLUMNS: MCol[] = (() => {
  const mapped: MCol[] = RESULT_COLUMNS.map((c) => ({
    key: c.key,
    label: c.label,
    render: (m, ctx) => c.render(m.listing, ctx),
  }));
  const estado: MCol = {
    key: "estado",
    label: "Estado",
    render: (m) => (m.state === "eligible" ? "Elegible" : m.state === "seen" ? "Vista" : "—"),
  };
  const idx = mapped.findIndex((c) => c.key === "link");
  return idx >= 0 ? [...mapped.slice(0, idx), estado, ...mapped.slice(idx)] : [...mapped, estado];
})();

// Default-hide the search-ranking artifacts (#, Score) and the rarely-needed ones.
const HIDDEN_BY_DEFAULT = new Set(["rank", "score", "admin", "estrato", "agency", "contact"]);
const DEFAULT_VISIBLE: Record<string, boolean> = Object.fromEntries(
  MARKED_COLUMNS.map((c) => [c.key, !HIDDEN_BY_DEFAULT.has(c.key)]),
);

export default function MarkedPage() {
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [reviews, setReviews] = useState<ReviewStore>({});
  const [selected, setSelected] = useState<ReviewLabel[]>(["eligible", "seen", "none"]);
  const [colVisible, setColVisible] = useState<Record<string, boolean>>(DEFAULT_VISIBLE);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    setHistory(loadJSON<HistoryEntry[]>(HISTORY_KEY, []));
    setReviews(loadJSON<ReviewStore>(REVIEW_KEY, {}));
    const savedCols = loadJSON<Record<string, boolean> | null>(COLS_KEY, null);
    if (savedCols) setColVisible({ ...DEFAULT_VISIBLE, ...savedCols });
  }, []);

  const all = useMemo(() => collectMarked(history, reviews), [history, reviews]);
  const counts = useMemo(() => stateCounts(all), [all]);
  const rows = useMemo(() => filterByState(all, selected), [all, selected]);
  const maxScore = useMemo(() => Math.max(1, ...all.map((m) => m.listing.score)), [all]);
  const cols = MARKED_COLUMNS.filter((c) => colVisible[c.key]);

  function toggleState(s: ReviewLabel) {
    setSelected((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));
  }
  function toggleCol(key: string) {
    setColVisible((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      saveJSON(COLS_KEY, next);
      return next;
    });
  }
  function onReview(l: ScoredListing, field: keyof ReviewState, val: boolean) {
    setReviews((prev) => {
      const next = setReview(prev, l, { [field]: val });
      saveJSON(REVIEW_KEY, next);
      return next;
    });
  }

  async function exportXlsx() {
    setExporting(true);
    try {
      const exportRows = rows.map(toExportRow);
      const res = await fetch("/api/export-xlsx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: exportRows, tema: "casas-marcadas" }),
      });
      const blob = await res.blob();
      const cd = res.headers.get("Content-Disposition") ?? "";
      const fn = cd.match(/filename="(.+?)"/)?.[1] ?? "casas-marcadas.xlsx";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fn;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }

  const ctx: RenderCtx = {
    maxScore,
    verifyMap: {},
    review: (l) => getReview(reviews, l),
    onReview,
  };

  return (
    <>
      <h1>Casas marcadas</h1>
      <p className="subtitle">
        Todas las casas de todos los historiales, agrupadas por estado. Marca/desmarca aquí mismo y
        expórtalas a Excel.
      </p>

      <div className="panel">
        <div className="row" style={{ gap: 8 }}>
          {STATES.map((s) => (
            <button
              key={s.key}
              className={selected.includes(s.key) ? "secondary" : "ghost"}
              onClick={() => toggleState(s.key)}
            >
              {s.label} ({counts[s.key]})
            </button>
          ))}
          <div className="spacer" />
          <ColumnPicker columns={MARKED_COLUMNS} visible={colVisible} onToggle={toggleCol} />
          <button onClick={exportXlsx} disabled={exporting || rows.length === 0}>
            {exporting ? "Exportando…" : `Exportar a Excel (${rows.length})`}
          </button>
        </div>
        <div className="notice" style={{ marginTop: 10 }}>
          La <strong>Distancia</strong> mostrada/exportada es la de la búsqueda más reciente donde
          apareció cada casa (su punto de referencia puede variar entre búsquedas).
        </div>
      </div>

      {all.length === 0 ? (
        <div className="panel">
          <p className="muted">
            No hay casas en el historial todavía. Ejecuta una búsqueda y marca casas como Vista o
            Elegible.
          </p>
        </div>
      ) : (
        <div className="panel">
          <div style={{ overflowX: "auto" }}>
            <table>
              <thead>
                <tr>
                  {cols.map((c) => (
                    <th key={c.key}>{c.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={cols.length} className="muted" style={{ padding: 16 }}>
                      Ninguna casa con los estados seleccionados.
                    </td>
                  </tr>
                ) : (
                  rows.map((m) => {
                    const l = m.listing;
                    const cls =
                      m.state === "eligible" ? "row-eligible" : m.state === "seen" ? "row-seen" : "";
                    return (
                      <tr key={`${l.source}-${l.sourceListingId}-${l.url}`} className={cls}>
                        {cols.map((c) => (
                          <td key={c.key}>{c.render(m, ctx)}</td>
                        ))}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
