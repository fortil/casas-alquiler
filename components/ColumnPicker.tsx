"use client";

/** Reusable "Columnas ▾" dropdown to toggle which table columns are shown. */
export function ColumnPicker({
  columns,
  visible,
  onToggle,
}: {
  columns: { key: string; label: string }[];
  visible: Record<string, boolean>;
  onToggle: (key: string) => void;
}) {
  return (
    <details className="col-picker">
      <summary>Columnas ▾</summary>
      <div className="col-picker-list">
        {columns.map((c) => (
          <label key={c.key} className="rev">
            <input type="checkbox" checked={!!visible[c.key]} onChange={() => onToggle(c.key)} />{" "}
            {c.label}
          </label>
        ))}
      </div>
    </details>
  );
}
