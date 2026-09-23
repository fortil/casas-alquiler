import { describe, it, expect } from "vitest";
import { DEFAULT_PARAMS, paramsToPayload } from "@/components/ParamsFields";

describe("paramsToPayload (manual coordinates precedence)", () => {
  it("uses manually typed coordinates exactly as given", () => {
    const p = paramsToPayload({
      ...DEFAULT_PARAMS,
      refLabel: "San Fernando, Cali",
      refLat: "3.1234",
      refLng: "-76.9876",
      refCoordsSource: "manual",
    });
    expect(p.refPoint).toEqual({ lat: 3.1234, lng: -76.9876 });
    expect(p.refCoordsSource).toBe("manual");
  });

  it("defaults to manual origin", () => {
    expect(DEFAULT_PARAMS.refCoordsSource).toBe("manual");
    expect(paramsToPayload(DEFAULT_PARAMS).refCoordsSource).toBe("manual");
  });

  it("propagates geocoded origin set by the 📍 button", () => {
    const p = paramsToPayload({ ...DEFAULT_PARAMS, refCoordsSource: "geocoded" });
    expect(p.refCoordsSource).toBe("geocoded");
  });
});
