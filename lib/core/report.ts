import type { ScoredListing } from "@/lib/core/schema";
import type { ScoreWeights } from "@/lib/core/score";

export interface ReportMeta {
  cities: string[];
  refPoint: { lat: number; lng: number };
  refLabel?: string;
  refCoordsSource?: "manual" | "geocoded";
  maxDistKm: number;
  minAreaM2: number;
  minBedrooms?: number;
  minPrice?: number;
  maxPrice?: number;
  weights: ScoreWeights;
  distanceMode: string;
  mode: "scrape" | "list";
  totalEvaluated: number;
  generatedAt?: Date;
}

function fmtCOP(n: number | null | undefined): string {
  if (n == null) return "—";
  return "$" + Math.round(n).toLocaleString("es-CO");
}

function n(v: number | null | undefined, digits = 0): string {
  if (v == null) return "—";
  return v.toFixed(digits);
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Filename per the user's global report rule: reporte_YYYY-MM-DD_<tema>.md */
export function reportFilename(tema: string, date = new Date()): string {
  const slug = tema
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `reporte_${isoDate(date)}_${slug}.md`;
}

/** Filename for the Excel export, e.g. casas-marcadas_2026-06-28.xlsx */
export function xlsxFilename(tema: string, date = new Date()): string {
  const slug = tema
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${slug || "casas"}_${isoDate(date)}.xlsx`;
}

/**
 * Build the Markdown report (English) following the global report rules:
 * header with date + author, sections Summary / Detail / Conclusions.
 */
export function buildReport(top: ScoredListing[], meta: ReportMeta): string {
  const date = meta.generatedAt ?? new Date();
  const lines: string[] = [];

  lines.push(`# Rental Search Report — Best Houses by Tenant Value`);
  lines.push("");
  lines.push(`**Date:** ${isoDate(date)}  `);
  lines.push(`**Author:** Claude Code (casas_alquiler)  `);
  lines.push(
    `**Mode:** ${meta.mode === "scrape" ? "Scraped portals" : "User-provided list"}  `,
  );
  lines.push("");

  // --- Summary ---
  lines.push(`## Summary`);
  lines.push("");
  lines.push(
    `Top ${top.length} rental houses ranked by tenant value-for-money (cost/m², area, distance).`,
  );
  lines.push("");
  lines.push(`- **Cities / zone:** ${meta.cities.join(", ") || "—"}`);
  const refOrigin =
    meta.refCoordsSource === "manual"
      ? "manual; address used as label only"
      : meta.refCoordsSource === "geocoded"
        ? "geocoded from address"
        : null;
  lines.push(
    `- **Reference point:** ${meta.refLabel ? `"${meta.refLabel}" — ` : ""}exact coordinates ${meta.refPoint.lat}, ${meta.refPoint.lng}` +
      `${refOrigin ? ` (${refOrigin})` : ""} — [Google Maps](https://www.google.com/maps?q=${meta.refPoint.lat},${meta.refPoint.lng})`,
  );
  lines.push(`- **Max distance:** ${meta.maxDistKm} km (${meta.distanceMode})`);
  lines.push(`- **Min area:** ${meta.minAreaM2} m²`);
  if (meta.minBedrooms && meta.minBedrooms > 0) {
    lines.push(`- **Min bedrooms:** ${meta.minBedrooms}`);
  }
  if ((meta.minPrice && meta.minPrice > 0) || (meta.maxPrice && meta.maxPrice > 0)) {
    const lo = meta.minPrice && meta.minPrice > 0 ? fmtCOP(meta.minPrice) : "—";
    const hi = meta.maxPrice && meta.maxPrice > 0 ? fmtCOP(meta.maxPrice) : "—";
    lines.push(`- **Price range:** ${lo} – ${hi}`);
  }
  lines.push(
    `- **Weights:** cost ${meta.weights.wCost}, area ${meta.weights.wArea}, distance ${meta.weights.wDist}`,
  );
  lines.push(`- **Listings evaluated (after filters):** ${meta.totalEvaluated}`);
  lines.push("");

  // --- Detail ---
  lines.push(`## Detail`);
  lines.push("");
  lines.push(
    `| # | Barrio / Conjunto | Area m² | Price | Admin | Cost/m² | Dist | Beds/Baths | Estrato | Agency | Contact | Source | Link |`,
  );
  lines.push(
    `|---|---|---|---|---|---|---|---|---|---|---|---|---|`,
  );
  for (const l of top) {
    const loc = [l.barrio, l.conjunto].filter(Boolean).join(" / ") || l.address || "—";
    const dist =
      l.drivingKm != null
        ? `${n(l.drivingKm, 1)} km / ${n(l.drivingMin, 0)} min`
        : l.distanceKm != null
          ? `${n(l.distanceKm, 1)} km`
          : "—";
    const contact = l.phone
      ? `${l.phone}${l.hasWhatsapp ? " (WA)" : ""}`
      : "—";
    const src = l.sources?.length ? l.sources.join("+") : l.source;
    lines.push(
      `| ${l.rank} | ${loc} | ${n(l.areaM2)} | ${fmtCOP(l.price)} | ${fmtCOP(l.admin)} | ${fmtCOP(l.costPerM2)} | ${dist} | ${l.bedrooms ?? "—"}/${l.bathrooms ?? "—"} | ${l.estrato ?? "—"} | ${l.agency ?? "—"} | ${contact} | ${src} | [ver](${l.url}) |`,
    );
  }
  lines.push("");

  // --- Conclusions ---
  lines.push(`## Conclusions`);
  lines.push("");
  if (top.length === 0) {
    lines.push(
      `No listings matched the hard filters (min area + max distance). Consider widening the radius, lowering min area, or refreshing the data.`,
    );
  } else {
    const best = top[0];
    const loc = [best.barrio, best.conjunto].filter(Boolean).join(" / ") || best.address || "—";
    lines.push(
      `- **Best value:** #${best.rank} ${loc} — ${n(best.areaM2)} m² at ${fmtCOP(best.price)} (${fmtCOP(best.costPerM2)}/m²), ${best.distanceKm != null ? `${n(best.distanceKm, 1)} km away` : "distance unknown"}.`,
    );
    lines.push(
      `- Contact data is best-effort: phone/agency availability varies by portal (most reliable on Ciencuadras and Properati).`,
    );
    lines.push(
      `- All listed properties passed a liveness check at generation time, but portals update fast — confirm availability before visiting.`,
    );
  }
  lines.push("");
  lines.push(`---`);
  lines.push(`_Generated by casas_alquiler. Distances ${meta.distanceMode}._`);
  lines.push("");

  return lines.join("\n");
}
