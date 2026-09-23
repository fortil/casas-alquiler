"use client";

import type { HistoryEntry } from "@/lib/searchHistory";

export function HistoryPanel<F>({
  entries,
  onRestore,
  onDelete,
  onClear,
}: {
  entries: HistoryEntry<F>[];
  onRestore: (e: HistoryEntry<F>) => void;
  onDelete: (id: string) => void;
  onClear: () => void;
}) {
  if (!entries.length) return null;
  return (
    <details className="panel" open>
      <summary style={{ cursor: "pointer", fontWeight: 600 }}>
        Búsquedas anteriores ({entries.length})
      </summary>
      <table style={{ marginTop: 12 }}>
        <thead>
          <tr>
            <th>Cuándo</th>
            <th>Búsqueda</th>
            <th style={{ width: 140 }}></th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.id}>
              <td className="muted">{new Date(e.ts).toLocaleString("es-CO")}</td>
              <td>{e.label}</td>
              <td>
                <div className="row" style={{ gap: 6 }}>
                  <button className="secondary" onClick={() => onRestore(e)}>
                    Ver
                  </button>
                  <button className="ghost" onClick={() => onDelete(e.id)} title="Eliminar">
                    ✕
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="row" style={{ marginTop: 8 }}>
        <button className="ghost" onClick={onClear}>
          Borrar historial
        </button>
      </div>
    </details>
  );
}
