import type { ReactNode } from "react";
import type { ResultMeta } from "@/components/ResultsView";

function cop(n: number | null | undefined): string {
  if (n == null || n === 0) return "—";
  return "$" + Math.round(n).toLocaleString("es-CO");
}

/** Compact, read-only summary of the parameters used for a search. */
export function ParamsSummary({ meta, mode }: { meta: ResultMeta; mode: "scrape" | "list" }) {
  const priceRange =
    (meta.minPrice && meta.minPrice > 0) || (meta.maxPrice && meta.maxPrice > 0)
      ? `${cop(meta.minPrice)} – ${cop(meta.maxPrice)}`
      : "Sin límite";

  // The exact coordinates are what the search actually used — the address is
  // only a label and may not match them, so always show both plus the origin.
  const mapsUrl = `https://www.google.com/maps?q=${meta.refPoint.lat},${meta.refPoint.lng}`;
  const refOrigin =
    meta.refCoordsSource === "manual"
      ? meta.refLabel
        ? `Coordenadas manuales · "${meta.refLabel}" es solo etiqueta`
        : "Coordenadas manuales"
      : meta.refCoordsSource === "geocoded"
        ? `Geocodificado de "${meta.refLabel ?? "la dirección"}"`
        : meta.refLabel
          ? `Dirección: ${meta.refLabel}`
          : null;

  const rows: [string, ReactNode][] = [
    ["Modo", mode === "scrape" ? "Rastreo de portales" : "Lista propia"],
    ["Ciudades", meta.cities.length ? meta.cities.join(", ") : "—"],
    [
      "Punto de referencia",
      <>
        <a
          href={mapsUrl}
          target="_blank"
          rel="noreferrer"
          title="Ver el punto exacto usado como referencia"
        >
          {meta.refPoint.lat}, {meta.refPoint.lng} ↗
        </a>
        {refOrigin ? <div className="hint" style={{ marginTop: 2 }}>{refOrigin}</div> : null}
      </>,
    ],
    ["Distancia máx.", `${meta.maxDistKm} km (${meta.distanceMode === "google_driving" ? "conducción" : "línea recta"})`],
    ["Área mín.", `${meta.minAreaM2} m²`],
    ["Habitaciones mín.", meta.minBedrooms ? String(meta.minBedrooms) : "—"],
    ["Rango de precio", priceRange],
    ["Pesos (costo/área/dist.)", `${meta.weights.wCost} / ${meta.weights.wArea} / ${meta.weights.wDist}`],
  ];

  return (
    <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
      {rows.map(([k, v]) => (
        <div key={k}>
          <div className="param-k">{k}</div>
          <div className="param-v">{v}</div>
        </div>
      ))}
    </div>
  );
}
