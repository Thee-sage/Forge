/**
 * Money & number helpers.
 *
 * Convention (see PROJECT_RULES §4): amounts are stored as positive numbers and the
 * sign/meaning is carried by a `direction` field. Rounding happens only for display,
 * never in intermediate computation.
 */

/** Round to `dp` decimal places. For display only. */
export function round(value: number, dp = 2): number {
  const f = 10 ** dp;
  return Math.round((value + Number.EPSILON) * f) / f;
}

/** Format a number as a currency string, e.g. formatMoney(1234.5, "USD") -> "$1,234.50". */
export function formatMoney(value: number, currency = "USD"): string {
  const symbol = CURRENCY_SYMBOLS[currency] ?? "";
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(round(value, 2));
  const withGroups = abs.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${sign}${symbol}${withGroups}${symbol ? "" : ` ${currency}`}`;
}

/** Format a ratio (0.1234) as a percentage string ("12.3%"). */
export function formatPercent(ratio: number, dp = 1): string {
  return `${round(ratio * 100, dp)}%`;
}

/** Safe division: returns 0 when the denominator is 0. */
export function safeDiv(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

/** Sum a list of numbers. */
export function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

/** Arithmetic mean; 0 for an empty list. */
export function mean(values: number[]): number {
  return values.length === 0 ? 0 : sum(values) / values.length;
}

/** Population standard deviation; 0 for a list shorter than 2. */
export function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  const variance = mean(values.map((v) => (v - m) ** 2));
  return Math.sqrt(variance);
}

/** Median of a list; 0 for an empty list. */
export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
    : sorted[mid] ?? 0;
}

/** Clamp a value into the inclusive range [min, max]. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: "$",
  EUR: "€",
  GBP: "£",
  INR: "₹",
  JPY: "¥",
  AUD: "A$",
  CAD: "C$",
};

/** Attempt to parse a currency symbol/code from a raw string cell. Returns undefined if none. */
export function detectCurrency(raw: string): string | undefined {
  const trimmed = raw.trim().toUpperCase();
  for (const code of Object.keys(CURRENCY_SYMBOLS)) {
    if (trimmed.includes(code)) return code;
  }
  for (const [code, symbol] of Object.entries(CURRENCY_SYMBOLS)) {
    if (raw.includes(symbol)) return code;
  }
  return undefined;
}


/**
 * Parse a loosely-formatted numeric cell into a number, or `undefined` when the cell is not
 * unambiguously a number. Forge never guesses: a malformed or ambiguous cell is rejected (and
 * the row is recorded as skipped with a reason) rather than turned into a plausible-looking
 * wrong value (PROJECT_RULES §5, "no silent assumptions").
 *
 * Accepted: plain numbers, currency symbols/codes ("$", "€", "Rs.", "USD"), a leading "+"/"-",
 * a trailing "-", accounting parentheses, the Unicode minus (U+2212), western (1,234.56) and
 * Indian (12,34,567.00) digit grouping, and scientific notation (1.5E3).
 * Rejected: multiple decimal points ("1.2.3"), embedded signs ("5-3"), decimal commas
 * ("1.234,56", "1,5"), space-grouped digits, and anything non-finite ("Infinity", "1e999").
 */
export function parseAmount(raw: unknown): number | undefined {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : undefined;
  if (typeof raw !== "string") return undefined;

  // Unicode minus / figure dash / en dash / em dash are sign characters, not punctuation.
  let s = raw.trim().replace(/[−‒–—]/g, "-");
  if (s === "") return undefined;

  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1).trim();
  }

  // Strip currency symbols and 2-3 letter currency codes ("Rs.", "USD"). Single letters and
  // longer words are NOT stripped, so "N/A" and "abc" stay non-numeric. A bare exponent
  // marker is preserved for scientific notation.
  s = s
    .replace(/A\$|C\$|[$€£₹¥]/g, "")
    .replace(/(?<![\d.])[A-Za-z]{2,3}\b\.?/g, "")
    .trim();

  // Sign: one leading "+"/"-" (possibly after the currency symbol) or one trailing "-".
  const lead = /^([+-])\s*/.exec(s);
  if (lead) {
    if (lead[1] === "-") negative = true;
    s = s.slice(lead[0].length);
  } else if (/-\s*$/.test(s)) {
    negative = true;
    s = s.replace(/\s*-\s*$/, "");
  }
  s = s.trim();

  let value: number;
  if (/^\d+(\.\d+)?[eE][+-]?\d+$/.test(s)) {
    value = Number(s);
  } else if (
    /^\d+(\.\d+)?$/.test(s) ||
    /^\.\d+$/.test(s) ||
    /^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s) ||
    /^\d{1,2}(,\d{2})+,\d{3}(\.\d+)?$/.test(s)
  ) {
    value = Number(s.replace(/,/g, ""));
  } else {
    return undefined;
  }
  if (!Number.isFinite(value)) return undefined;
  return negative ? -value : value;
}
