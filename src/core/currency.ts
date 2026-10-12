/**
 * Currency as structured, validated data — never merely display text (hardening §1).
 *
 * Forge does NOT perform FX conversion (out of scope). The engine's guarantee is instead
 * one of *integrity*: monetary values from different currencies must never be silently
 * summed. Aggregations therefore fail clearly (via `CurrencyMismatchError`) rather than
 * produce a meaningless mixed-currency total.
 */

import { ForgeError } from "./errors.js";

/** Thrown when an aggregation would combine values from more than one currency. */
export class CurrencyMismatchError extends ForgeError {
  readonly currencies: string[];
  constructor(currencies: string[], context: string) {
    super(
      `Cannot ${context}: values span multiple currencies (${currencies.join(
        ", ",
      )}). Forge does not convert between currencies (FX is out of scope); ` +
        `analyse each currency in a separate run, or provide pre-converted data.`,
    );
    this.name = "CurrencyMismatchError";
    this.currencies = currencies;
  }
}

/** Symbols we recognise and the ISO code they map to. */
const SYMBOL_TO_CODE: Record<string, string> = {
  $: "USD",
  "€": "EUR",
  "£": "GBP",
  "₹": "INR",
  "¥": "JPY",
  "A$": "AUD",
  "C$": "CAD",
  "Rs": "INR",
  "Rs.": "INR",
};

/** Common lowercase words / codes mapped to ISO codes. */
const WORD_TO_CODE: Record<string, string> = {
  usd: "USD",
  dollar: "USD",
  dollars: "USD",
  eur: "EUR",
  euro: "EUR",
  euros: "EUR",
  gbp: "GBP",
  pound: "GBP",
  pounds: "GBP",
  inr: "INR",
  rupee: "INR",
  rupees: "INR",
  jpy: "JPY",
  yen: "JPY",
  aud: "AUD",
  cad: "CAD",
};

/**
 * Normalise a raw currency cell into a canonical ISO-4217-style code.
 * Returns undefined when the value is empty/unrecognised so the caller can fall back to a
 * declared default rather than inventing a currency.
 */
export function normalizeCurrencyCode(raw: unknown): string | undefined {
  if (raw === null || raw === undefined) return undefined;
  const s = String(raw).trim();
  if (s === "") return undefined;

  // Exact symbol match.
  if (SYMBOL_TO_CODE[s]) return SYMBOL_TO_CODE[s];

  const lower = s.toLowerCase();
  if (WORD_TO_CODE[lower]) return WORD_TO_CODE[lower];

  // A bare 3-letter code (any — we don't hard-limit to a known list).
  if (/^[a-z]{3}$/i.test(s)) return s.toUpperCase();

  // Symbol embedded in a longer string (e.g. "USD $"). Longest symbol first so "A$" is AUD, not "$" = USD.
  for (const [sym, code] of SYMBOLS_LONGEST_FIRST) {
    if (s.includes(sym)) return code;
  }
  return undefined;
}

const SYMBOLS_LONGEST_FIRST = Object.entries(SYMBOL_TO_CODE).sort((a, b) => b[0].length - a[0].length);

/** ISO codes we accept when they appear next to an amount ("USD 500"); a stray 3-letter word is not a currency. */
const KNOWN_CODES = new Set([...Object.values(SYMBOL_TO_CODE), ...Object.values(WORD_TO_CODE), "CHF", "CNY", "SGD", "NZD", "HKD"]);

/**
 * The currency an amount cell carries on its face ("€20.00", "USD 500", "Rs.500"), or
 * undefined for a bare number. Lets a file with no currency column still declare its currency
 * so differing symbols cannot be summed as if they were one currency.
 */
export function currencyInAmountText(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const text = raw.trim();
  if (text === "") return undefined;
  const code = /(?<![A-Za-z])([A-Za-z]{3})(?![A-Za-z])/.exec(text);
  if (code) {
    const upper = code[1]!.toUpperCase();
    if (KNOWN_CODES.has(upper)) return upper;
  }
  for (const [sym, iso] of SYMBOLS_LONGEST_FIRST) {
    if (text.includes(sym)) return iso;
  }
  return undefined;
}

/** Distinct currencies present across a set of monetary items, in first-seen order. */
export function distinctCurrencies(items: { currency: string }[]): string[] {
  const seen: string[] = [];
  for (const it of items) {
    if (!seen.includes(it.currency)) seen.push(it.currency);
  }
  return seen;
}

/**
 * Assert that every item shares one currency and return it (or undefined if empty).
 * Throws `CurrencyMismatchError` otherwise — the mechanism by which Forge refuses to
 * silently mix currencies.
 */
export function assertSingleCurrency(
  items: { currency: string }[],
  context: string,
): string | undefined {
  const currencies = distinctCurrencies(items);
  if (currencies.length > 1) throw new CurrencyMismatchError(currencies, context);
  return currencies[0];
}
