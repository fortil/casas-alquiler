"use client";

import { useState } from "react";
import { FieldLabel } from "@/components/FieldLabel";

export interface ParamValues {
  refLat: string;
  refLng: string;
  refLabel: string;
  /** Origin of the current refLat/refLng: typed by hand vs produced by the 📍 button. */
  refCoordsSource: "manual" | "geocoded";
  maxDistKm: string;
  minAreaM2: string;
  minBedrooms: string;
  minPrice: string;
  maxPrice: string;
  distanceMode: "haversine" | "google_driving";
  rankByValue: boolean;
  wCost: string;
  wArea: string;
  wDist: string;
  topN: string;
}

export const DEFAULT_PARAMS: ParamValues = {
  refLat: "3.4516",
  refLng: "-76.5320",
  refLabel: "Centro, Cali",
  refCoordsSource: "manual",
  maxDistKm: "8",
  minAreaM2: "80",
  minBedrooms: "0",
  minPrice: "0",
  maxPrice: "0",
  distanceMode: "haversine",
  rankByValue: true,
  wCost: "0.5",
  wArea: "0.3",
  wDist: "0.2",
  topN: "10",
};

export function ParamsFields({
  value,
  onChange,
}: {
  value: ParamValues;
  onChange: (v: ParamValues) => void;
}) {
  const [geocoding, setGeocoding] = useState(false);
  const [geoMsg, setGeoMsg] = useState<string | null>(null);
  const set = (patch: Partial<ParamValues>) => onChange({ ...value, ...patch });

  const latNum = parseFloat(value.refLat);
  const lngNum = parseFloat(value.refLng);
  const coordsValid =
    Number.isFinite(latNum) &&
    Math.abs(latNum) <= 90 &&
    Number.isFinite(lngNum) &&
    Math.abs(lngNum) <= 180;
  const isGeocoded = value.refCoordsSource === "geocoded";
  const mapsUrl = `https://www.google.com/maps?q=${latNum},${lngNum}`;

  async function geocodeAddress() {
    if (!value.refLabel.trim()) return;
    setGeocoding(true);
    setGeoMsg(null);
    try {
      const res = await fetch("/api/geocode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: value.refLabel }),
      });
      const data = await res.json();
      if (data.lat != null) {
        set({ refLat: String(data.lat), refLng: String(data.lng), refCoordsSource: "geocoded" });
        setGeoMsg(`✓ Coordenadas reemplazadas: ${data.lat.toFixed(5)}, ${data.lng.toFixed(5)} (${data.precision})`);
      } else {
        setGeoMsg(`✗ ${data.error ?? "sin resultado"}`);
      }
    } catch (e) {
      setGeoMsg(`✗ ${(e as Error).message}`);
    } finally {
      setGeocoding(false);
    }
  }

  return (
    <div className="grid">
      <div style={{ gridColumn: "span 2" }}>
        <FieldLabel tip="Lugar desde donde se mide la distancia (tu trabajo, una zona, etc.). Escribe una dirección y pulsa 📍 para ubicarla (reemplaza las coordenadas actuales). Al buscar siempre se usan las coordenadas de Latitud/Longitud, nunca esta dirección.">
          Punto de referencia (dirección)
        </FieldLabel>
        <div className="row" style={{ flexWrap: "nowrap" }}>
          <input
            type="text"
            value={value.refLabel}
            onChange={(e) => set({ refLabel: e.target.value, refCoordsSource: "manual" })}
            placeholder="p.ej. San Fernando, Cali"
          />
          <button className="ghost" type="button" onClick={geocodeAddress} disabled={geocoding}>
            {geocoding ? "…" : "📍"}
          </button>
        </div>
        {geoMsg && <div className="hint">{geoMsg}</div>}
      </div>
      <div>
        <FieldLabel
          tip={
            isGeocoded
              ? "Coordenada obtenida al pulsar 📍. Si la editas a mano, esa coordenada manual es exactamente la que se usará."
              : "Coordenada manual: es exactamente la que se usará para calcular distancias; la dirección queda solo como etiqueta."
          }
        >
          {`Latitud ${isGeocoded ? "(geocodificada)" : "(manual)"}`}
        </FieldLabel>
        <input
          type="text"
          value={value.refLat}
          onChange={(e) => set({ refLat: e.target.value, refCoordsSource: "manual" })}
        />
      </div>
      <div>
        <FieldLabel
          tip={
            isGeocoded
              ? "Coordenada obtenida al pulsar 📍. Si la editas a mano, esa coordenada manual es exactamente la que se usará."
              : "Coordenada manual: es exactamente la que se usará para calcular distancias; la dirección queda solo como etiqueta."
          }
        >
          {`Longitud ${isGeocoded ? "(geocodificada)" : "(manual)"}`}
        </FieldLabel>
        <input
          type="text"
          value={value.refLng}
          onChange={(e) => set({ refLng: e.target.value, refCoordsSource: "manual" })}
        />
      </div>
      <div style={{ gridColumn: "span 2" }}>
        {coordsValid ? (
          <div className="hint">
            {isGeocoded
              ? `✓ Geocodificado de la dirección: ${latNum}, ${lngNum}.`
              : `✎ Se usarán exactamente estas coordenadas: ${latNum}, ${lngNum}${
                  value.refLabel.trim() ? " — la dirección es solo etiqueta" : ""
                }.`}{" "}
            <a href={mapsUrl} target="_blank" rel="noreferrer">
              Ver en Google Maps ↗
            </a>
          </div>
        ) : (
          <div className="error">
            ⚠ Coordenadas inválidas: la latitud debe estar entre -90 y 90, y la longitud entre
            -180 y 180. La búsqueda fallará hasta corregirlas.
          </div>
        )}
      </div>
      <div>
        <FieldLabel tip="Solo se incluyen propiedades a esta distancia (o menos) del punto de referencia.">
          Distancia máx. (km)
        </FieldLabel>
        <input
          type="number"
          value={value.maxDistKm}
          onChange={(e) => set({ maxDistKm: e.target.value })}
        />
      </div>
      <div>
        <FieldLabel tip="Solo propiedades con al menos esta área construida en metros cuadrados.">
          Área mín. (m²)
        </FieldLabel>
        <input
          type="number"
          value={value.minAreaM2}
          onChange={(e) => set({ minAreaM2: e.target.value })}
        />
      </div>
      <div>
        <FieldLabel tip="Solo propiedades con al menos este número de habitaciones. Las que no publican habitaciones se conservan.">
          Habitaciones mín.
        </FieldLabel>
        <input
          type="number"
          min="0"
          value={value.minBedrooms}
          onChange={(e) => set({ minBedrooms: e.target.value })}
        />
      </div>
      <div>
        <FieldLabel tip="Canon de arriendo mensual mínimo (COP). 0 = sin mínimo.">
          Precio mín. (COP)
        </FieldLabel>
        <input
          type="number"
          min="0"
          value={value.minPrice}
          onChange={(e) => set({ minPrice: e.target.value })}
        />
      </div>
      <div>
        <FieldLabel tip="Canon de arriendo mensual máximo (COP). 0 = sin máximo.">
          Precio máx. (COP)
        </FieldLabel>
        <input
          type="number"
          min="0"
          value={value.maxPrice}
          onChange={(e) => set({ maxPrice: e.target.value })}
        />
      </div>
      <div>
        <FieldLabel tip="Línea recta = rápido y gratis (haversine). Conducción = distancia/tiempo reales por carretera (usa Google Maps; requiere clave).">
          Modo de distancia
        </FieldLabel>
        <select
          value={value.distanceMode}
          onChange={(e) => set({ distanceMode: e.target.value as ParamValues["distanceMode"] })}
        >
          <option value="haversine">Línea recta (rápido)</option>
          <option value="google_driving">Conducción (Google)</option>
        </select>
      </div>
      <div>
        <FieldLabel tip="Cuántas propiedades se resaltan como las mejores y se incluyen en el reporte exportado.">
          Top N
        </FieldLabel>
        <input type="number" value={value.topN} onChange={(e) => set({ topN: e.target.value })} />
      </div>
      <div>
        <FieldLabel tip="Si lo desactivas, el ranking ignora el precio/valor por m² y ordena solo por área y cercanía.">
          Rankear por precio/valor
        </FieldLabel>
        <div className="checkbox-row">
          <input
            type="checkbox"
            id="rankByValue"
            checked={value.rankByValue}
            onChange={(e) => set({ rankByValue: e.target.checked })}
          />
          <label htmlFor="rankByValue">Considerar $/m²</label>
        </div>
      </div>
      <div>
        <FieldLabel tip="Importancia del costo por m² en el puntaje. Más peso = prioriza lo más barato por metro cuadrado. Se ignora si desactivas 'Rankear por precio/valor'.">
          Peso costo/m²
        </FieldLabel>
        <input
          type="number"
          step="0.05"
          value={value.wCost}
          disabled={!value.rankByValue}
          onChange={(e) => set({ wCost: e.target.value })}
        />
      </div>
      <div>
        <FieldLabel tip="Importancia del área en el puntaje. Más peso = prioriza casas más grandes.">
          Peso área
        </FieldLabel>
        <input type="number" step="0.05" value={value.wArea} onChange={(e) => set({ wArea: e.target.value })} />
      </div>
      <div>
        <FieldLabel tip="Importancia de la cercanía en el puntaje. Más peso = prioriza lo más cerca del punto de referencia.">
          Peso distancia
        </FieldLabel>
        <input type="number" step="0.05" value={value.wDist} onChange={(e) => set({ wDist: e.target.value })} />
      </div>
    </div>
  );
}

/** Convert form strings into the numeric payload shared by both modes. */
export function paramsToPayload(v: ParamValues) {
  return {
    refPoint: { lat: parseFloat(v.refLat), lng: parseFloat(v.refLng) },
    refLabel: v.refLabel,
    refCoordsSource: v.refCoordsSource,
    maxDistKm: parseFloat(v.maxDistKm) || 0,
    minAreaM2: parseFloat(v.minAreaM2) || 0,
    minBedrooms: parseInt(v.minBedrooms, 10) || 0,
    minPrice: parseFloat(v.minPrice) || 0,
    maxPrice: parseFloat(v.maxPrice) || 0,
    distanceMode: v.distanceMode,
    weights: {
      // when "rank by value" is off, drop the cost/m² term entirely
      wCost: v.rankByValue ? parseFloat(v.wCost) || 0 : 0,
      wArea: parseFloat(v.wArea) || 0,
      wDist: parseFloat(v.wDist) || 0,
    },
    topN: parseInt(v.topN, 10) || 10,
  };
}
