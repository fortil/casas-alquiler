const ENTRIES: { term: string; meaning: string }[] = [
  { term: "#", meaning: "Posición en el ranking por relevancia (1 = mejor valor para inquilino). No cambia al reordenar la tabla." },
  {
    term: "Score",
    meaning:
      "Puntaje de valor (0–1, mayor = mejor). Combina costo/m², área y distancia con los pesos configurados (por defecto 0.5 / 0.3 / 0.2).",
  },
  { term: "m²", meaning: "Área construida en metros cuadrados." },
  { term: "Precio", meaning: "Canon de arriendo mensual (COP)." },
  { term: "Admin", meaning: "Cuota de administración mensual (COP). “—” o 0 cuando el portal no la publica." },
  {
    term: "$/m²",
    meaning: "Costo mensual total por metro cuadrado = (Precio + Admin) ÷ Área. Menor es mejor; es el criterio principal del ranking.",
  },
  {
    term: "Dist.",
    meaning:
      "Distancia al punto de referencia. En modo línea recta: km (haversine). En modo Google: km y minutos de conducción reales.",
  },
  {
    term: "≈",
    meaning:
      "Ubicación aproximada: el aviso no traía coordenadas y se geocodificó por barrio/conjunto. La tolerancia de distancia se amplía para no descartarlo injustamente.",
  },
  { term: "Hab/Bañ", meaning: "Número de habitaciones / baños." },
  { term: "Estr.", meaning: "Estrato socioeconómico (1 a 6)." },
  { term: "Inmobiliaria", meaning: "Agencia o inmobiliaria que publica el aviso." },
  { term: "Contacto", meaning: "Teléfono del aviso. 🟢 indica que tiene WhatsApp." },
  {
    term: "Fuente",
    meaning:
      "Portal(es) de origen. “a+b” = el mismo inmueble se encontró en varias fuentes y se fusionó (dedup). Tras pulsar “Verificar disponibilidad”: ✓ disponible · ✗ no disponible.",
  },
];

export function Legend() {
  return (
    <details className="panel">
      <summary style={{ cursor: "pointer", fontWeight: 600 }}>
        ¿Qué significa cada columna? (abreviaturas)
      </summary>
      <table style={{ marginTop: 12 }}>
        <thead>
          <tr>
            <th style={{ width: 130 }}>Abreviatura</th>
            <th>Significado</th>
          </tr>
        </thead>
        <tbody>
          {ENTRIES.map((e) => (
            <tr key={e.term}>
              <td>
                <span className="badge">{e.term}</span>
              </td>
              <td>{e.meaning}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}
