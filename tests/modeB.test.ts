import { describe, it, expect } from "vitest";
import { parseListInput } from "@/lib/core/modeB";

describe("parseListInput", () => {
  it("parses canonical headers and Colombian numbers", () => {
    const csv = `Barrio,Conjunto,Area,Precio,Link
San Fernando,Bambú,120,2.500.000,https://example.com/a
Pance,Reserva,95,1900000,`;
    const { listings } = parseListInput(csv);
    expect(listings).toHaveLength(2);
    expect(listings[0].barrio).toBe("San Fernando");
    expect(listings[0].areaM2).toBe(120);
    expect(listings[0].price).toBe(2500000);
    expect(listings[0].url).toBe("https://example.com/a");
    // row without a valid link gets a synthetic but valid URL
    expect(listings[1].url.startsWith("https://manual.local/")).toBe(true);
  });

  it("accepts header aliases (Área, Valor, Administración, m2)", () => {
    const csv = `Sector,Urbanizacion,Área (m2),Valor,Administracion
El Caney,Torres,80,1.600.000,250000`;
    const { listings } = parseListInput(csv);
    expect(listings).toHaveLength(1);
    expect(listings[0].barrio).toBe("El Caney");
    expect(listings[0].conjunto).toBe("Torres");
    expect(listings[0].areaM2).toBe(80);
    expect(listings[0].price).toBe(1600000);
    expect(listings[0].admin).toBe(250000);
  });

  it("ignores rows with neither area nor price and warns on empty input", () => {
    const { listings, warnings } = parseListInput("Barrio,Area,Precio\nFoo,,");
    expect(listings).toHaveLength(0);
    expect(warnings.length).toBeGreaterThan(0);
  });
});
