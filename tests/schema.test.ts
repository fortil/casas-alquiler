import { describe, it, expect } from "vitest";
import { isValidPoint } from "@/lib/core/schema";

describe("isValidPoint", () => {
  it("accepts finite numeric coordinates", () => {
    expect(isValidPoint({ lat: 3.4, lng: -76.5 })).toBe(true);
    expect(isValidPoint({ lat: 0, lng: 0 })).toBe(true);
  });

  it("rejects null / undefined / missing components", () => {
    expect(isValidPoint(null)).toBe(false);
    expect(isValidPoint(undefined)).toBe(false);
    expect(isValidPoint({})).toBe(false);
    expect(isValidPoint({ lat: 3.4 })).toBe(false);
  });

  it("rejects NaN and Infinity", () => {
    expect(isValidPoint({ lat: NaN, lng: -76 })).toBe(false);
    expect(isValidPoint({ lat: 3.4, lng: Infinity })).toBe(false);
    expect(isValidPoint({ lat: -Infinity, lng: -Infinity })).toBe(false);
  });
});
