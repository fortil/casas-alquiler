/** Text + number parsing helpers shared by adapters. Colombian formatting aware. */

/** Lowercase, strip accents/diacritics, collapse whitespace. */
export function norm(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Title-case a normalized string for display. */
export function titleCase(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .trim()
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Parse a Colombian price string to a number of pesos.
 * Handles "$ 1.450.000", "1.450.000 COP$", "3,800,000", "1300000".
 * Returns null when no plausible amount is found.
 */
export function parsePriceCOP(input: string | number | null | undefined): number | null {
  if (input == null) return null;
  if (typeof input === "number") return Number.isFinite(input) && input > 0 ? input : null;
  const digits = input.replace(/[^\d]/g, "");
  if (!digits) return null;
  const n = parseInt(digits, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Parse an area string to m². Handles "90 m2", "86", "120,5 m²", "100m2".
 * Returns the first number found (comma or dot decimal), or null.
 */
export function parseArea(input: string | number | null | undefined): number | null {
  if (input == null) return null;
  if (typeof input === "number") return Number.isFinite(input) && input > 0 ? input : null;
  const m = input.match(/(\d+(?:[.,]\d+)?)/);
  if (!m) return null;
  const n = parseFloat(m[1].replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Parse an integer from messy text ("3 habitaciones" -> 3). */
export function parseIntSafe(input: string | number | null | undefined): number | null {
  if (input == null) return null;
  if (typeof input === "number") return Number.isInteger(input) ? input : Math.round(input);
  const m = input.match(/-?\d+/);
  if (!m) return null;
  const n = parseInt(m[0], 10);
  return Number.isFinite(n) ? n : null;
}

/** Extract a Colombian mobile/landline phone (10 digits, optional +57) from text. */
export function extractPhone(text: string | null | undefined): string | null {
  if (!text) return null;
  // Prefer a 10-digit number starting with 3 (mobile) or 60 (landline NDC).
  const mobile = text.match(/(?:\+?57[\s-]?)?(3\d{2}[\s-]?\d{3}[\s-]?\d{4})/);
  if (mobile) return mobile[1].replace(/[\s-]/g, "");
  const landline = text.match(/(?:\+?57[\s-]?)?(60[\s-]?\d[\s-]?\d{3}[\s-]?\d{4})/);
  if (landline) return landline[1].replace(/[\s-]/g, "");
  return null;
}

/** True when `needle` and `hay` overlap as normalized substrings (either direction). */
export function fuzzyContains(hay: string | null | undefined, needle: string): boolean {
  const h = norm(hay);
  const n = norm(needle);
  if (!h || !n) return false;
  return h.includes(n) || n.includes(h);
}

/** Round a number to `d` decimals (helper for dedup signatures). */
export function round(n: number, d = 0): number {
  const f = 10 ** d;
  return Math.round(n * f) / f;
}
