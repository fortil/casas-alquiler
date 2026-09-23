import ExcelJS from "exceljs";
import { EXPORT_HEADERS, type ExportRow } from "@/lib/markedHouses";

const NUM_FMT: Partial<Record<(typeof EXPORT_HEADERS)[number], string>> = {
  "m²": "0",
  Precio: '"$"#,##0',
  "$/m²": "#,##0",
  "Distancia (km)": "0.0",
  Habitaciones: "0",
};

const WIDTHS: Record<string, number> = {
  "Barrio/Conjunto": 32,
  Ciudad: 14,
  "m²": 8,
  Precio: 14,
  "$/m²": 12,
  "Distancia (km)": 14,
  Habitaciones: 13,
  Estado: 12,
  Enlace: 50,
};

/** Build a real .xlsx workbook for the marked-houses export. Returns a Buffer. */
export async function buildMarkedWorkbook(rows: ExportRow[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Marcadas");

  ws.columns = EXPORT_HEADERS.map((h) => ({
    header: h,
    key: h,
    width: WIDTHS[h] ?? 16,
    style: NUM_FMT[h] ? { numFmt: NUM_FMT[h] } : undefined,
  }));
  ws.getRow(1).font = { bold: true };

  for (const r of rows) {
    // null numeric values must stay empty, not 0
    ws.addRow(r as unknown as Record<string, unknown>);
  }

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}
