import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { buildMarkedWorkbook } from "@/lib/exportXlsx";
import { EXPORT_HEADERS, toExportRow, type ExportRow } from "@/lib/markedHouses";
import type { ScoredListing } from "@/lib/core/schema";

async function readBack(buf: Buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  return wb.getWorksheet("Marcadas")!;
}

function row(over: Partial<ExportRow>): ExportRow {
  return {
    "Barrio/Conjunto": "Pance",
    Ciudad: "Cali",
    "m²": 86,
    Precio: 1_300_000,
    "$/m²": 15000,
    "Distancia (km)": 4.3,
    Habitaciones: 3,
    Estado: "Elegible",
    Enlace: "https://x.com/a",
    ...over,
  };
}

describe("buildMarkedWorkbook", () => {
  it("produces a header-only but valid file for 0 rows", async () => {
    const ws = await readBack(await buildMarkedWorkbook([]));
    expect((ws.getRow(1).values as unknown[]).slice(1)).toEqual([...EXPORT_HEADERS]);
    expect(ws.rowCount).toBe(1);
  });

  it("keeps numeric cells numeric and writes data rows", async () => {
    const ws = await readBack(await buildMarkedWorkbook([row({})]));
    expect(ws.rowCount).toBe(2);
    // m² is the 3rd column, Precio the 4th, $/m² the 5th
    expect(ws.getRow(2).getCell(3).value).toBe(86);
    expect(ws.getRow(2).getCell(4).value).toBe(1_300_000); // Precio
    expect(ws.getRow(2).getCell(5).value).toBe(15000); // $/m²
  });

  it("preserves the formula-injection guard from sanitizeCell", async () => {
    // a barrio of "=HACK()" must have been sanitized to "'=HACK()" upstream
    const malicious = toExportRow({
      listing: { barrio: "=HACK()", conjunto: null, address: null, city: "Cali", url: "https://x", source: "s", sourceListingId: "1", areaM2: 80, costPerM2: 1000, bedrooms: 2, distanceKm: 3 } as ScoredListing,
      state: "none",
      review: {},
    });
    expect(malicious["Barrio/Conjunto"]).toBe("'=HACK()");
    const ws = await readBack(await buildMarkedWorkbook([malicious]));
    const v = ws.getRow(2).getCell(1).value;
    expect(String(v).startsWith("'")).toBe(true);
  });

  it("leaves null numeric cells empty (not 0)", async () => {
    const ws = await readBack(await buildMarkedWorkbook([row({ "m²": null, Precio: null, "Distancia (km)": null })]));
    expect(ws.getRow(2).getCell(3).value).toBeFalsy(); // empty, not 0
    expect(ws.getRow(2).getCell(4).value).toBeFalsy();
    expect(ws.getRow(2).getCell(6).value).toBeFalsy();
  });
});
