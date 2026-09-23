"use client";

import { useEffect, useState } from "react";
import { DEFAULT_PARAMS, type ParamValues } from "@/components/ParamsFields";
import { SOUTHERN_CALI_ZONES } from "@/lib/config";
import { DiscoverPanel } from "@/components/DiscoverPanel";

/** Editorial method notes per adapter id — the registry itself only knows id/tier/domain. */
const SOURCE_NOTES: Record<string, string> = {
  bienco: "API JSON interna",
  fincaraiz: "__NEXT_DATA__ (estrato, admin)",
  ciencuadras: "JSON-LD + teléfono",
  properati: "JSON-LD + teléfono en detalle",
  rentola: "JSON-LD por aviso / sitemap",
  inmobiliariajr: "WASI (una sola agencia)",
  inmoalfaguara: "sitemap + JSON-LD (Jamundí)",
  elpaisfincaraiz: "tarjetas HTML (tel + WhatsApp)",
  mitula: "agregador (sin teléfono)",
  metrocuadrado: "Bright Data (Imperva + geo)",
};

export interface SourceMeta {
  id: string;
  tier: string;
  domain: string;
}

export function ConfigClient({ sources }: { sources: SourceMeta[] }) {
  const [defaults, setDefaults] = useState<Partial<ParamValues>>({});
  const [zones, setZones] = useState<string>(SOUTHERN_CALI_ZONES.join(", "));
  const [saved, setSaved] = useState(false);
  const [hasMapKey, setHasMapKey] = useState(false);

  useEffect(() => {
    setHasMapKey(!!process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY);
    try {
      const d = localStorage.getItem("ca_defaults");
      if (d) setDefaults(JSON.parse(d));
      const z = localStorage.getItem("ca_zones");
      if (z) setZones(JSON.parse(z).join(", "));
    } catch {
      /* ignore */
    }
  }, []);

  function field(key: keyof ParamValues, label: string) {
    const val = (defaults[key] ?? DEFAULT_PARAMS[key]) as string;
    return (
      <div>
        <label>{label}</label>
        <input
          type="text"
          value={val}
          onChange={(e) => setDefaults((d) => ({ ...d, [key]: e.target.value }))}
        />
      </div>
    );
  }

  function save() {
    localStorage.setItem("ca_defaults", JSON.stringify(defaults));
    localStorage.setItem(
      "ca_zones",
      JSON.stringify(zones.split(",").map((z) => z.trim()).filter(Boolean)),
    );
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  return (
    <>
      <h1>Configuración</h1>
      <p className="subtitle">Valores por defecto del formulario y definición de zonas.</p>

      <div className="panel">
        <h2>Valores por defecto</h2>
        <div className="grid">
          {field("refLabel", "Punto de referencia")}
          {field("refLat", "Latitud")}
          {field("refLng", "Longitud")}
          {field("maxDistKm", "Distancia máx (km)")}
          {field("minAreaM2", "Área mín (m²)")}
          {field("minBedrooms", "Habitaciones mín.")}
          {field("minPrice", "Precio mín (COP)")}
          {field("maxPrice", "Precio máx (COP)")}
          {field("wCost", "Peso costo/m²")}
          {field("wArea", "Peso área")}
          {field("wDist", "Peso distancia")}
        </div>
      </div>

      <div className="panel">
        <h2>Sur de Cali (barrios / comunas)</h2>
        <textarea value={zones} onChange={(e) => setZones(e.target.value)} style={{ minHeight: 80 }} />
        <div className="hint">
          Lista separada por comas. Se usa para filtrar &quot;solo sur de Cali&quot; cuando los
          portales no permiten filtrar por sub-zona.
        </div>
      </div>

      <div className="row">
        <button onClick={save}>Guardar</button>
        {saved && <span className="badge good">Guardado</span>}
      </div>

      <div className="panel" style={{ marginTop: 18 }}>
        <h2>Estado de claves</h2>
        <p>
          <span className={`badge ${hasMapKey ? "good" : "warn"}`}>
            {hasMapKey ? "✓" : "✗"} Mapa (NEXT_PUBLIC_GOOGLE_MAPS_API_KEY)
          </span>
        </p>
        <div className="hint">
          Las claves de servidor (GOOGLE_MAPS_API_KEY, BRIGHTDATA_API_KEY) se configuran en{" "}
          <code>.env</code> y no se exponen al navegador. Sin <code>GOOGLE_MAPS_API_KEY</code> la
          geocodificación de barrios y la distancia por conducción quedan deshabilitadas (la línea
          recta sigue funcionando con coordenadas de la fuente).
        </div>
      </div>

      <div className="panel">
        <h2>Fuentes ({sources.length})</h2>
        <table>
          <thead>
            <tr>
              <th>Fuente</th>
              <th>Dominio</th>
              <th>Tier</th>
              <th>Método</th>
            </tr>
          </thead>
          <tbody>
            {sources.map((a) => (
              <tr key={a.id}>
                <td>{a.id}</td>
                <td className="muted">{a.domain}</td>
                <td>
                  <span className="badge muted">{a.tier}</span>
                </td>
                <td>{SOURCE_NOTES[a.id] ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="hint">
          MercadoLibre y PuntoPropiedad se excluyen (su robots.txt prohíbe crawlers de IA). Habi.co
          es solo venta (no arriendos).
        </div>
      </div>

      <DiscoverPanel />
    </>
  );
}
