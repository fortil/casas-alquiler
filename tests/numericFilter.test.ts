import { describe, it, expect } from "vitest";
import { parseNumericFilter } from "@/lib/util/numericFilter";

const test = (expr: string) => parseNumericFilter(expr).test;
const M = 1_000_000;

describe("parseNumericFilter — empty / pass-through", () => {
  it("blank and whitespace match everything and are flagged empty", () => {
    for (const e of ["", "   ", "\t"]) {
      const p = parseNumericFilter(e);
      expect(p.empty).toBe(true);
      expect(p.invalid).toBe(false);
      expect(p.test(1)).toBe(true);
      expect(p.test(null)).toBe(true); // empty filter does not exclude nulls
    }
  });
});

describe("operators", () => {
  it("< <= > >= = ==", () => {
    expect(test("<2M")(1_999_999)).toBe(true);
    expect(test("<2M")(2_000_000)).toBe(false);
    expect(test("<=2M")(2_000_000)).toBe(true);
    expect(test(">2M")(2_000_001)).toBe(true);
    expect(test(">2M")(2_000_000)).toBe(false);
    expect(test(">=2M")(2_000_000)).toBe(true);
    expect(test("=2M")(2_000_000)).toBe(true);
    expect(test("==2M")(2_000_000)).toBe(true);
    expect(test("=2M")(2_000_001)).toBe(false);
  });
});

describe("suffixes", () => {
  it("k/K = ×1e3, m/M = ×1e6", () => {
    expect(test(">=800k")(800_000)).toBe(true);
    expect(test(">=800K")(799_999)).toBe(false);
    expect(test("<2M")(1_500_000)).toBe(true);
    expect(test("<2m")(1_500_000)).toBe(true);
    expect(test("< 2 M")(1_999_999)).toBe(true); // spaces inside
  });
});

describe("decimals", () => {
  it("1.5M, =1.5M, plain 90.5", () => {
    expect(test("<1.5M")(1_499_999)).toBe(true);
    expect(test("<1.5M")(1_500_001)).toBe(false);
    expect(test("=1.5M")(1.5 * M)).toBe(true);
    expect(test(">=90.5")(90.5)).toBe(true);
    expect(test(">=90.5")(90)).toBe(false);
  });
});

describe("ranges", () => {
  it("inclusive, reversed normalizes, spaced, degenerate", () => {
    expect(test("1M-2M")(1_500_000)).toBe(true);
    expect(test("1M-2M")(900_000)).toBe(false);
    expect(test("1M-2M")(2_000_000)).toBe(true); // inclusive
    expect(test("3M-2M")(2_500_000)).toBe(true); // reversed -> [2M,3M]
    expect(test("1M - 2M")(1_500_000)).toBe(true);
    expect(test("90-90")(90)).toBe(true);
    expect(test("90-90")(91)).toBe(false);
  });
});

describe("garbage => invalid, matches all, never throws", () => {
  const bad = ["abc", "<", ">>2", "2M-", "-2M", "-", "2M-3M-4M", "1,5M", "2X", "=<2M", "M"];
  it.each(bad)("'%s' is invalid", (e) => {
    let p!: ReturnType<typeof parseNumericFilter>;
    expect(() => (p = parseNumericFilter(e))).not.toThrow();
    expect(p.invalid).toBe(true);
    expect(p.test(123)).toBe(true); // invalid never blanks the table
  });
});

describe("null / undefined handling", () => {
  it("excluded under an active filter, allowed under empty", () => {
    expect(test("<2M")(null)).toBe(false);
    expect(test("<2M")(undefined)).toBe(false);
    expect(test(">=0")(null)).toBe(false);
    expect(parseNumericFilter("").test(null)).toBe(true);
    // an invalid filter also passes nulls (it matches all)
    expect(parseNumericFilter("abc").test(null)).toBe(true);
  });
});

describe("float equality epsilon", () => {
  it("tolerates 0.1 + 0.2 drift", () => {
    expect(test("=0.3")(0.1 + 0.2)).toBe(true);
  });
});

describe("bare number is a floor (>=)", () => {
  it("'2M' matches 2_000_001 but '=2M' does not", () => {
    expect(test("2M")(2_000_001)).toBe(true);
    expect(test("2M")(1_999_999)).toBe(false);
    expect(test("=2M")(2_000_001)).toBe(false);
  });
});

describe("zero / boundaries", () => {
  it(">=0, bare 0, <0", () => {
    expect(test(">=0")(0)).toBe(true);
    expect(test("0")(0)).toBe(true); // bare 0 => >=0
    expect(test("<0")(0)).toBe(false);
    expect(test("<0")(-1)).toBe(true);
  });
});
