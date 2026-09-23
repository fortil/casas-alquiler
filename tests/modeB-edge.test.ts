import { describe, it, expect } from "vitest";
import { parseListInput } from "@/lib/core/modeB";

describe("parseListInput — delimiters & formats", () => {
  it("parses tab-separated paste", () => {
    const tsv = "Barrio\tArea\tPrecio\nPance\t95\t1900000";
    const { listings } = parseListInput(tsv);
    expect(listings).toHaveLength(1);
    expect(listings[0].barrio).toBe("Pance");
    expect(listings[0].areaM2).toBe(95);
    expect(listings[0].price).toBe(1900000);
  });

  it("parses semicolon-separated values", () => {
    const csv = "Barrio;Area;Precio\nEl Caney;80;1.600.000";
    const { listings } = parseListInput(csv);
    expect(listings).toHaveLength(1);
    expect(listings[0].price).toBe(1600000);
  });

  it("strips currency symbols and spaces from prices", () => {
    const csv = "Barrio,Area,Precio\nA,100,$ 1.300.000\nB,100,COP 2 000 000";
    const { listings } = parseListInput(csv);
    expect(listings[0].price).toBe(1300000);
    expect(listings[1].price).toBe(2000000);
  });

  it("normalizes header accents, case and surrounding spaces", () => {
    const csv = " BARRIO , Área (m2) , PRECIO \nPance,90,1000000";
    const { listings } = parseListInput(csv);
    expect(listings[0].barrio).toBe("Pance");
    expect(listings[0].areaM2).toBe(90);
    expect(listings[0].price).toBe(1000000);
  });
});

describe("parseListInput — robustness / failures", () => {
  it("warns and returns nothing for empty input", () => {
    const { listings, warnings } = parseListInput("   ");
    expect(listings).toHaveLength(0);
    expect(warnings.length).toBeGreaterThan(0);
  });

  it("warns when only a header row is present", () => {
    const { listings, warnings } = parseListInput("Barrio,Area,Precio");
    expect(listings).toHaveLength(0);
    expect(warnings.length).toBeGreaterThan(0);
  });

  it("keeps a row with area only or price only, skips rows with neither", () => {
    const csv = "Barrio,Area,Precio\nAreaOnly,100,\nPriceOnly,,1500000\nNeither,,";
    const { listings } = parseListInput(csv);
    expect(listings.map((l) => l.barrio)).toEqual(["AreaOnly", "PriceOnly"]);
  });

  it("gives a valid synthetic URL when the link is missing or malformed", () => {
    const csv = "Barrio,Area,Precio,Link\nA,100,1000000,\nB,100,1000000,not-a-url";
    const { listings } = parseListInput(csv);
    expect(listings[0].url).toMatch(/^https:\/\/manual\.local\//);
    expect(listings[1].url).toMatch(/^https:\/\/manual\.local\//);
    // a real link is preserved
    const ok = parseListInput("Barrio,Area,Precio,Link\nA,100,1000000,https://x.com/y").listings[0];
    expect(ok.url).toBe("https://x.com/y");
  });

  it("ignores unknown columns without crashing", () => {
    const csv = "Barrio,Area,Precio,Color,Notas\nPance,100,1000000,azul,bonita";
    const { listings } = parseListInput(csv);
    expect(listings).toHaveLength(1);
    expect(listings[0].barrio).toBe("Pance");
  });
});
