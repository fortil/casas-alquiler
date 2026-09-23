"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { ScoredListing } from "@/lib/core/schema";
import { PropertyMap, type MapPoint } from "@/components/PropertyMap";
import { Legend } from "@/components/Legend";
import { ColumnPicker } from "@/components/ColumnPicker";
import {
  RESULT_COLUMNS as COLUMNS,
  RESULT_DEFAULT_VISIBLE as DEFAULT_VISIBLE,
  locStr,
  type RenderCtx,
} from "@/components/resultColumns";
import { type SortKey, isSortable, sortListings, cycleSort } from "@/lib/util/tableSort";
import { parseNumericFilter } from "@/lib/util/numericFilter";
import { loadJSON, saveJSON } from "@/lib/clientStore";
import {
  getReview,
  setReview,
  REVIEW_KEY,
  type ReviewState,
  type ReviewStore,
} from "@/lib/reviewStore";
import { reviewLabel, type ReviewLabel } from "@/lib/markedHouses";

export interface ResultMeta {
  cities: string[];
  refPoint: { lat: number; lng: number };
  refLabel?: string;
  refCoordsSource?: "manual" | "geocoded";
  maxDistKm: number;
  minAreaM2: number;
  minBedrooms?: number;
  minPrice?: number;
  maxPrice?: number;
  weights: { wCost: number; wArea: number; wDist: number };
  distanceMode: string;
}

export interface ResultPayload {
  top: ScoredListing[];
  ranked: ScoredListing[];
  stats: Record<string, number>;
  droppedReasons?: Record<string, number>;
  generatedAt?: string;
  lastRunAt?: string | null;
  totalActive?: number;
  warnings?: string[];
  parsed?: number;
}

const COLS_KEY = "ca_columns";

/** Columns that accept a numeric filter expression, with how to read the value. */
const FILTERABLE: Record<string, (l: ScoredListing) => number | null | undefined> = {
  price: (l) => l.price,
  area: (l) => l.areaM2,
};

export function ResultsView({
  result,
  meta,
  mode,
}: {
  result: ResultPayload;
  meta: ResultMeta;
  mode: "scrape" | "list";
}) {
  const [verifying, setVerifying] = useState(false);
  const [verifyMap, setVerifyMap] = useState<Record<string, { isActive: boolean; reason: string }>>({});
  const [sortKeys, setSortKeys] = useState<SortKey[]>([]);
  const [reviews, setReviews] = useState<ReviewStore>({});
  const [colVisible, setColVisible] = useState<Record<string, boolean>>(DEFAULT_VISIBLE);
  const [colFilters, setColFilters] = useState<Record<string, string>>({}); // raw input (instant)
  const [appliedFilters, setAppliedFilters] = useState<Record<string, string>>({}); // debounced
  const ALL_STATES: ReviewLabel[] = ["eligible", "seen", "none"];
  const [reviewFilter, setReviewFilter] = useState<ReviewLabel[]>(ALL_STATES);

  // Load persisted review state + column visibility (shared across all views).
  useEffect(() => {
    setReviews(loadJSON<ReviewStore>(REVIEW_KEY, {}));
    const savedCols = loadJSON<Record<string, boolean> | null>(COLS_KEY, null);
    if (savedCols) setColVisible({ ...DEFAULT_VISIBLE, ...savedCols });
  }, []);

  // Debounce filtering so half-typed exprs (e.g. "<2" on the way to "<2M") don't
  // momentarily empty the table on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => setAppliedFilters(colFilters), 350);
    return () => clearTimeout(t);
  }, [colFilters]);

  function clearFilters() {
    setColFilters({});
    setAppliedFilters({});
    setReviewFilter(["eligible", "seen", "none"]);
  }

  const ranked = result.ranked ?? [];
  const maxScore = useMemo(() => Math.max(1, ...ranked.map((r) => r.score)), [ranked]);

  // Active filters: numeric (visible filterable columns, valid expr) + review state.
  const filtered = useMemo(() => {
    const numeric = Object.entries(appliedFilters)
      .filter(([key, expr]) => colVisible[key] && FILTERABLE[key] && expr.trim() !== "")
      .map(([key, expr]) => ({ read: FILTERABLE[key], parsed: parseNumericFilter(expr) }))
      .filter((f) => !f.parsed.empty && !f.parsed.invalid);
    const reviewActive = colVisible.review && reviewFilter.length < 3;
    if (numeric.length === 0 && !reviewActive) return ranked;
    const allowed = new Set(reviewFilter);
    return ranked.filter((l) => {
      if (numeric.length && !numeric.every((f) => f.parsed.test(f.read(l)))) return false;
      if (reviewActive && !allowed.has(reviewLabel(getReview(reviews, l)))) return false;
      return true;
    });
  }, [ranked, appliedFilters, colVisible, reviews, reviewFilter]);

  const rows = useMemo(() => sortListings(filtered, sortKeys), [filtered, sortKeys]);
  const anyFilter =
    (colVisible.review && reviewFilter.length < 3) ||
    Object.entries(appliedFilters).some(
      ([key, expr]) => colVisible[key] && FILTERABLE[key] && expr.trim() !== "",
    );

  function onReview(l: ScoredListing, field: keyof ReviewState, val: boolean) {
    setReviews((prev) => {
      const next = setReview(prev, l, { [field]: val });
      saveJSON(REVIEW_KEY, next);
      return next;
    });
  }

  function toggleCol(key: string) {
    setColVisible((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      saveJSON(COLS_KEY, next);
      return next;
    });
  }

  const ctx: RenderCtx = {
    maxScore,
    verifyMap,
    review: (l) => getReview(reviews, l),
    onReview,
  };
  const cols = COLUMNS.filter((c) => colVisible[c.key]);

  const points: MapPoint[] = useMemo(
    () =>
      rows
        .filter((l) => l.lat != null && l.lng != null)
        .slice(0, 50)
        .map((l) => ({ lat: l.lat!, lng: l.lng!, rank: l.rank, title: locStr(l) })),
    [rows],
  );

  async function downloadReport() {
    const res = await fetch("/api/report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        top: result.top,
        tema: mode === "scrape" ? "casas-alquiler" : "mi-lista",
        meta: {
          cities: meta.cities,
          refPoint: meta.refPoint,
          refLabel: meta.refLabel,
          refCoordsSource: meta.refCoordsSource,
          maxDistKm: meta.maxDistKm,
          minAreaM2: meta.minAreaM2,
          minBedrooms: meta.minBedrooms,
          minPrice: meta.minPrice,
          maxPrice: meta.maxPrice,
          weights: meta.weights,
          distanceMode: meta.distanceMode,
          mode,
          totalEvaluated: result.stats?.kept ?? result.top.length,
        },
      }),
    });
    const blob = await res.blob();
    const cd = res.headers.get("Content-Disposition") ?? "";
    const fn = cd.match(/filename="(.+?)"/)?.[1] ?? "reporte.md";
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fn;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function verifyTop() {
    setVerifying(true);
    try {
      const urls = result.top.map((l) => l.url).filter((u) => !u.startsWith("https://manual.local"));
      const res = await fetch("/api/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urls, persist: mode === "scrape" }),
      });
      const data = await res.json();
      setVerifyMap(data.results ?? {});
    } finally {
      setVerifying(false);
    }
  }

  return (
    <>
      <div className="panel">
        <div className="row" style={{ marginBottom: 8 }}>
          <div className="stat">
            <span className="n">{result.top.length}</span>
            <span className="l">Top mostrado</span>
          </div>
          <div className="stat">
            <span className="n">{result.stats?.kept ?? ranked.length}</span>
            <span className="l">Cumplen filtros</span>
          </div>
          <div className="stat">
            <span className="n">{result.stats?.input ?? "—"}</span>
            <span className="l">Evaluadas</span>
          </div>
          {result.totalActive != null && (
            <div className="stat">
              <span className="n">{result.totalActive}</span>
              <span className="l">Activas en BD</span>
            </div>
          )}
          {result.stats?.drivingComputed ? (
            <div className="stat">
              <span className="n">{result.stats.drivingComputed}</span>
              <span className="l">Dist. Google</span>
            </div>
          ) : null}
          <div className="spacer" />
          <button className="secondary" onClick={verifyTop} disabled={verifying}>
            {verifying ? "Verificando…" : "Verificar disponibilidad"}
          </button>
          <button onClick={downloadReport} disabled={!result.top.length}>
            Descargar reporte
          </button>
        </div>
        {result.lastRunAt && (
          <div className="hint">
            Datos del último rastreo: {new Date(result.lastRunAt).toLocaleString("es-CO")}
          </div>
        )}
        {result.warnings?.length ? <div className="hint">⚠ {result.warnings.join(" · ")}</div> : null}
      </div>

      {ranked.length > 0 && (
        <div className="panel" style={{ padding: 0, overflow: "hidden" }}>
          <PropertyMap refPoint={meta.refPoint} maxDistKm={meta.maxDistKm} points={points} />
        </div>
      )}

      <div className="panel">
        <div className="row" style={{ marginBottom: 10 }}>
          <h2 style={{ margin: 0 }}>
            Resultados ({anyFilter ? `${rows.length} de ${ranked.length}` : rows.length})
          </h2>
          {(Object.values(colFilters).some((v) => v.trim() !== "") || reviewFilter.length < 3) && (
            <button className="ghost" onClick={clearFilters}>
              Limpiar filtros
            </button>
          )}
          <div className="spacer" />
          <ColumnPicker columns={COLUMNS} visible={colVisible} onToggle={toggleCol} />
          <SortStatus sortKeys={sortKeys} onReset={() => setSortKeys([])} />
        </div>
        {ranked.length === 0 ? (
          <p className="muted">
            Ninguna propiedad cumple los filtros. Amplía la distancia, baja el área mínima o
            refresca los datos.
          </p>
        ) : (
          <div style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                {cols.map((col) => {
                  const sortable = isSortable(col.key);
                  const skIdx = sortKeys.findIndex((s) => s.key === col.key);
                  const sk = skIdx >= 0 ? sortKeys[skIdx] : null;
                  return (
                    <th
                      key={col.key}
                      onClick={sortable ? () => setSortKeys((p) => cycleSort(p, col.key)) : undefined}
                      className={sortable ? "sortable" : ""}
                      style={sortable ? { cursor: "pointer", userSelect: "none" } : undefined}
                      title={sortable ? "Clic para ordenar (acumulativo)" : undefined}
                    >
                      <div>
                        {col.label}
                        {sortable ? (
                          <span className="sort-ind">
                            {sk ? (
                              <>
                                {sk.dir === "asc" ? " ▲" : " ▼"}
                                {sortKeys.length > 1 ? <sup>{skIdx + 1}</sup> : null}
                              </>
                            ) : (
                              <span className="sort-dim"> ↕</span>
                            )}
                          </span>
                        ) : null}
                      </div>
                      {FILTERABLE[col.key] ? (
                        <ColumnFilterInput
                          value={colFilters[col.key] ?? ""}
                          invalid={parseNumericFilter(colFilters[col.key] ?? "").invalid}
                          onChange={(v) => setColFilters((p) => ({ ...p, [col.key]: v }))}
                        />
                      ) : null}
                      {col.key === "review" ? (
                        <ReviewFilter selected={reviewFilter} onChange={setReviewFilter} />
                      ) : null}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={cols.length} className="muted" style={{ padding: 16 }}>
                    Ningún resultado con los filtros actuales (de {ranked.length}). Ajusta el filtro
                    o usa “Limpiar filtros”.
                  </td>
                </tr>
              ) : (
                rows.map((l) => {
                const rv = getReview(reviews, l);
                const cls = [
                  l.rank <= 10 ? "top10" : "",
                  rv.eligible ? "row-eligible" : rv.seen ? "row-seen" : "",
                ]
                  .filter(Boolean)
                  .join(" ");
                return (
                  <tr key={`${l.source}-${l.sourceListingId}`} className={cls}>
                    {cols.map((col) => (
                      <td key={col.key}>{col.render(l, ctx)}</td>
                    ))}
                  </tr>
                );
              })
              )}
            </tbody>
          </table>
          </div>
        )}
      </div>

      {rows.length > 0 && <Legend />}
    </>
  );
}

function ColumnFilterInput({
  value,
  invalid,
  onChange,
}: {
  value: string;
  invalid: boolean;
  onChange: (v: string) => void;
}) {
  // stopPropagation everywhere so interacting with the filter never triggers
  // the header's sort onClick.
  return (
    <div className="col-filter" onClick={(e) => e.stopPropagation()}>
      <input
        className={invalid ? "invalid" : ""}
        value={value}
        placeholder="ej: <2M"
        title="Filtro numérico: <2M, >=800k, 1M-2M, =90"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        onChange={(e) => onChange(e.target.value)}
      />
      {value ? (
        <button
          type="button"
          className="cf-clear"
          title="Limpiar"
          onClick={(e) => {
            e.stopPropagation();
            onChange("");
          }}
        >
          ×
        </button>
      ) : null}
    </div>
  );
}

const REVIEW_OPTS: { key: ReviewLabel; label: string }[] = [
  { key: "eligible", label: "Elegible" },
  { key: "seen", label: "Vista" },
  { key: "none", label: "Sin marca" },
];

function ReviewFilter({
  selected,
  onChange,
}: {
  selected: ReviewLabel[];
  onChange: (next: ReviewLabel[]) => void;
}) {
  const active = selected.length < 3;
  const toggle = (s: ReviewLabel) =>
    onChange(selected.includes(s) ? selected.filter((x) => x !== s) : [...selected, s]);
  return (
    <details className="col-picker col-filter-review" onClick={(e) => e.stopPropagation()}>
      <summary className={active ? "rf-active" : ""}>
        {active ? `Filtrar (${selected.length})` : "Filtrar"} ▾
      </summary>
      <div className="col-picker-list">
        {REVIEW_OPTS.map((o) => (
          <label key={o.key} className="rev">
            <input
              type="checkbox"
              checked={selected.includes(o.key)}
              onChange={() => toggle(o.key)}
            />{" "}
            {o.label}
          </label>
        ))}
      </div>
    </details>
  );
}

function SortStatus({ sortKeys, onReset }: { sortKeys: SortKey[]; onReset: () => void }) {
  if (sortKeys.length === 0) {
    return (
      <span className="hint">Orden: por relevancia (score). Clic en una columna para reordenar.</span>
    );
  }
  return (
    <div className="row" style={{ gap: 8 }}>
      <span className="hint">
        Orden:{" "}
        {sortKeys.map((s, i) => {
          const label = COLUMNS.find((c) => c.key === s.key)?.label ?? s.key;
          return (
            <span key={s.key} className="badge" style={{ marginRight: 4 }}>
              {i + 1}. {label} {s.dir === "asc" ? "▲" : "▼"}
            </span>
          );
        })}
      </span>
      <button className="ghost" onClick={onReset}>
        Reset orden
      </button>
    </div>
  );
}
