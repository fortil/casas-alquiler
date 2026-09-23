import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseDetail, safeSiteUrl } from "@/lib/adapters/century21";

const FIXTURE = readFileSync(
  join(__dirname, "fixtures", "century21-detail-casa.html"),
  "utf8",
);

const DETAIL_URL =
  "https://century21colombia.com/propiedad/150916_casa-en-renta-en-primero-de-mayo-cali-valle-del-cauca-colombia";

describe("century21 parseDetail (fixture: casa en renta, Cali)", () => {
  const parsed = parseDetail(FIXTURE, DETAIL_URL);
  if (!parsed) throw new Error("fixture no parseó");

  it("detecta operación y tipo desde el <title>", () => {
    expect(parsed.op).toBe("renta");
    expect(parsed.type).toBe("casa");
  });

  it("mapea los meta tags al esquema Listing", () => {
    const l = parsed.listing;
    expect(l.source).toBe("century21");
    expect(l.sourceListingId).toBe("150916");
    expect(l.barrio).toBe("Primero De Mayo");
    expect(l.city).toBe("Cali");
    expect(l.areaM2).toBe(98); // MC=98 (construidos)
    expect(l.bedrooms).toBe(4);
    expect(l.bathrooms).toBe(2);
    expect(l.parking).toBe(2);
    expect(l.price).toBe(2000000);
    expect(l.currency).toBe("COP");
  });

  it("usa la URL canónica del sitio como url final", () => {
    expect(parsed.listing.url).toBe(
      "https://century21colombia.com/propiedad/150916_casa-amplia-primer-piso-barrio-primero-de-mayo-sur-cali",
    );
  });

  it("devuelve null si no hay id en la URL ni meta clave", () => {
    expect(parseDetail("<html><body>x</body></html>", "https://century21colombia.com/foo")).toBeNull();
  });
});

describe("century21 safeSiteUrl (guarda SSRF)", () => {
  it("acepta http(s) del host propio y subdominios, con rutas relativas", () => {
    expect(safeSiteUrl("/propiedad/1_x")).toBe("https://century21colombia.com/propiedad/1_x");
    expect(safeSiteUrl("https://century21colombia.com/propiedad/1_x")).toBe(
      "https://century21colombia.com/propiedad/1_x",
    );
    expect(safeSiteUrl("http://www.century21colombia.com/x")).toBe("http://www.century21colombia.com/x");
  });

  it("rechaza localhost, IPs privadas/reservadas, otros hosts y esquemas", () => {
    expect(safeSiteUrl("http://localhost/propiedad/1")).toBeNull();
    expect(safeSiteUrl("http://127.0.0.1/propiedad/1")).toBeNull();
    expect(safeSiteUrl("http://192.168.1.5/propiedad/1")).toBeNull();
    expect(safeSiteUrl("http://10.0.0.1/propiedad/1")).toBeNull();
    expect(safeSiteUrl("http://169.254.1.1/propiedad/1")).toBeNull();
    expect(safeSiteUrl("http://[::1]/propiedad/1")).toBeNull();
    expect(safeSiteUrl("https://evil.com/propiedad/1")).toBeNull();
    expect(safeSiteUrl("https://century21colombia.com.evil.com/1")).toBeNull();
    expect(safeSiteUrl("file:///etc/passwd")).toBeNull();
    expect(safeSiteUrl("javascript:alert(1)")).toBeNull();
  });
});
