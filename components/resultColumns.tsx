import type { ReactNode } from "react";
import type { ScoredListing } from "@/lib/core/schema";
import type { ReviewState } from "@/lib/reviewStore";

/**
 * Shared table column definitions used by both the results table (ResultsView)
 * and the marked-houses page, so the two never diverge.
 */

export function cop(n: number | null | undefined): string {
  if (n == null) return "—";
  return "$" + Math.round(n).toLocaleString("es-CO");
}
export function num(n: number | null | undefined, d = 0): string {
  return n == null ? "—" : n.toFixed(d);
}
export function locStr(l: ScoredListing): string {
  return [l.barrio, l.conjunto].filter(Boolean).join(" / ") || l.address || "—";
}

export interface RenderCtx {
  maxScore: number;
  verifyMap: Record<string, { isActive: boolean; reason: string }>;
  review: (l: ScoredListing) => ReviewState;
  onReview: (l: ScoredListing, field: keyof ReviewState, val: boolean) => void;
}

export interface Column {
  key: string; // matches a SORT_ACCESSORS key when sortable
  label: string;
  defaultVisible: boolean;
  render: (l: ScoredListing, ctx: RenderCtx) => ReactNode;
}

export const RESULT_COLUMNS: Column[] = [
  {
    key: "review",
    label: "Revisión",
    defaultVisible: true,
    render: (l, ctx) => {
      const r = ctx.review(l);
      return (
        <div className="rev-cell">
          <label className="rev">
            <input
              type="checkbox"
              checked={!!r.seen}
              onChange={(e) => ctx.onReview(l, "seen", e.target.checked)}
            />{" "}
            Vista
          </label>
          <label className="rev">
            <input
              type="checkbox"
              checked={!!r.eligible}
              onChange={(e) => ctx.onReview(l, "eligible", e.target.checked)}
            />{" "}
            Elegible
          </label>
        </div>
      );
    },
  },
  { key: "rank", label: "#", defaultVisible: true, render: (l) => l.rank },
  {
    key: "score",
    label: "Score",
    defaultVisible: true,
    render: (l, ctx) => (
      <div className="score-bar" title={l.score.toFixed(3)}>
        <div style={{ width: `${(l.score / ctx.maxScore) * 100}%` }} />
      </div>
    ),
  },
  { key: "loc", label: "Barrio / Conjunto", defaultVisible: true, render: (l) => locStr(l) },
  { key: "city", label: "Ciudad", defaultVisible: true, render: (l) => l.city ?? "—" },
  { key: "area", label: "m²", defaultVisible: true, render: (l) => num(l.areaM2) },
  { key: "price", label: "Precio", defaultVisible: true, render: (l) => cop(l.price) },
  { key: "admin", label: "Admin", defaultVisible: false, render: (l) => cop(l.admin) },
  { key: "cpm2", label: "$/m²", defaultVisible: true, render: (l) => cop(l.costPerM2) },
  {
    key: "dist",
    label: "Dist.",
    defaultVisible: true,
    render: (l) => {
      const d =
        l.drivingKm != null
          ? `${num(l.drivingKm, 1)} km · ${num(l.drivingMin, 0)}′`
          : l.distanceKm != null
            ? `${num(l.distanceKm, 1)} km`
            : "—";
      const approx =
        l.geocodePrecision && l.geocodePrecision !== "source" && l.geocodePrecision !== "rooftop";
      return (
        <>
          {d}
          {approx ? (
            <span className="badge muted" title="ubicación aproximada">
              {" "}
              ≈
            </span>
          ) : null}
        </>
      );
    },
  },
  { key: "beds", label: "Hab/Bañ", defaultVisible: true, render: (l) => `${l.bedrooms ?? "—"}/${l.bathrooms ?? "—"}` },
  { key: "estrato", label: "Estr.", defaultVisible: false, render: (l) => l.estrato ?? "—" },
  { key: "agency", label: "Inmobiliaria", defaultVisible: false, render: (l) => l.agency ?? "—" },
  {
    key: "contact",
    label: "Contacto",
    defaultVisible: false,
    render: (l) =>
      l.phone ? (
        <span>
          {l.phone}
          {l.hasWhatsapp ? " 🟢" : ""}
        </span>
      ) : (
        "—"
      ),
  },
  {
    key: "source",
    label: "Fuente",
    defaultVisible: true,
    render: (l, ctx) => {
      const v = ctx.verifyMap[l.url];
      const ids = l.sources?.length ? l.sources : [l.source];
      const links = l.sourceLinks ?? [];
      const multi = ids.length > 1;
      const display = ids.length > 2 ? `${ids[0]} +${ids.length - 1}` : ids.join("+");
      const title = multi
        ? `Encontrado en ${ids.length} portales:\n` +
          (links.length ? links.map((s) => `• ${s.source}: ${s.url}`).join("\n") : ids.join(", "))
        : `Fuente: ${ids[0]}`;
      return (
        <>
          <span className="badge" title={title} style={multi ? { cursor: "help" } : undefined}>
            {display}
            {multi ? " 🔁" : ""}
          </span>
          {v ? (
            <span className={`badge ${v.isActive ? "good" : "warn"}`} title={v.reason}>
              {v.isActive ? "✓" : "✗"}
            </span>
          ) : null}
        </>
      );
    },
  },
  {
    key: "link",
    label: "Abrir",
    defaultVisible: true,
    render: (l) =>
      l.url.startsWith("https://manual.local") ? (
        <span className="muted">—</span>
      ) : (
        <button
          className="secondary"
          style={{ padding: "4px 10px", whiteSpace: "nowrap" }}
          onClick={() => window.open(l.url, "_blank", "noopener,noreferrer")}
          title={l.url}
        >
          ↗
        </button>
      ),
  },
];

export const RESULT_DEFAULT_VISIBLE: Record<string, boolean> = Object.fromEntries(
  RESULT_COLUMNS.map((c) => [c.key, c.defaultVisible]),
);
