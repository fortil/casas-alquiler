/**
 * Tiny, dependency-free parser for per-column numeric filters like "<2M",
 * ">=800k", "1M-2M". Pure and total — parseNumericFilter NEVER throws.
 *
 * Grammar:  blank | op? number | number "-" number
 *   op      : < <= > >= = ==
 *   number  : \d+(\.\d+)?  with optional suffix k/K (×1e3) or m/M (×1e6)
 *   range   : "a-b" inclusive (reversed is normalized)
 *
 * Decisions:
 *  - a bare number (no operator) means ">=" (a floor): exact "=" on a continuous
 *    quantity almost never matches a real row, so a quick-typed "2M" would dead-end.
 *  - a null/undefined cell value is EXCLUDED while a filter is active.
 *  - an unparseable expression is `invalid` and matches everything (the table is
 *    never blanked by a typo; the UI shows it red instead).
 *  - "=" / "==" use a small relative epsilon to survive float drift.
 *  - comma decimals ("1,5M") are rejected (ambiguous with COP thousands grouping).
 */

export type NumericPredicate = (value: number | null | undefined) => boolean;

export interface ParsedFilter {
  empty: boolean;
  invalid: boolean;
  test: NumericPredicate;
}

const MATCH_ALL: NumericPredicate = () => true;

/** Parse a number token with optional k/M suffix; whitespace inside is ignored. */
function parseAmount(token: string): number | null {
  const t = token.replace(/\s+/g, "");
  const m = /^(\d+(?:\.\d+)?)([kKmM]?)$/.exec(t);
  if (!m) return null;
  let n = parseFloat(m[1]);
  const suf = m[2].toLowerCase();
  if (suf === "k") n *= 1e3;
  else if (suf === "m") n *= 1e6;
  return Number.isFinite(n) ? n : null;
}

/** Wrap a numeric comparison so a null/non-finite cell never passes an active filter. */
function active(core: (n: number) => boolean): NumericPredicate {
  return (v) => v != null && Number.isFinite(v) && core(v as number);
}

function opPredicate(op: string, target: number): NumericPredicate {
  switch (op) {
    case "<":
      return active((v) => v < target);
    case "<=":
      return active((v) => v <= target);
    case ">":
      return active((v) => v > target);
    case ">=":
      return active((v) => v >= target);
    case "=":
    case "==": {
      // small enough to not tolerate integer-peso differences, large enough
      // to absorb float representation drift (~value·2e-16).
      const eps = 1e-9 * Math.max(1, Math.abs(target));
      return active((v) => Math.abs(v - target) <= eps);
    }
    default:
      return MATCH_ALL;
  }
}

export function parseNumericFilter(expr: string): ParsedFilter {
  const s = (expr ?? "").trim();
  if (s === "") return { empty: true, invalid: false, test: MATCH_ALL };

  const invalid = (): ParsedFilter => ({ empty: false, invalid: true, test: MATCH_ALL });

  // operator form: <, <=, >, >=, =, == (longer ops first)
  const opm = /^(<=|>=|==|<|>|=)\s*(.+)$/.exec(s);
  if (opm) {
    const amount = parseAmount(opm[2]);
    if (amount == null) return invalid();
    return { empty: false, invalid: false, test: opPredicate(opm[1], amount) };
  }

  // range form: a-b (exactly one dash, no operator)
  const rng = /^([^-]+)-([^-]+)$/.exec(s);
  if (rng) {
    const a = parseAmount(rng[1]);
    const b = parseAmount(rng[2]);
    if (a == null || b == null) return invalid();
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    return {
      empty: false,
      invalid: false,
      test: active((v) => v >= lo && v <= hi),
    };
  }

  // bare number => ">=" (a floor)
  const amount = parseAmount(s);
  if (amount == null) return invalid();
  return { empty: false, invalid: false, test: active((v) => v >= amount) };
}

/** Convenience: just the predicate. */
export function numericFilterPredicate(expr: string): NumericPredicate {
  return parseNumericFilter(expr).test;
}
