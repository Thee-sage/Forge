/**
 * The unified financial model — the source-agnostic contract every downstream module
 * reads (see ARCHITECTURE.md §4). Ingestion adapters are the only code that knows about
 * source formats; they produce these entities.
 */

/** A raw source row, kept for traceability on every derived entity. */
export type RawRecord = Record<string, unknown>;

/** Money movement direction. Amount is always positive; direction carries the sign. */
export type Direction = "inflow" | "outflow";

/** Broad asset classes for portfolio holdings. */
export type AssetClass =
  | "equity"
  | "fixed_income"
  | "cash"
  | "real_estate"
  | "commodity"
  | "crypto"
  | "alternative"
  | "unknown";

/** A single dated money movement. */
export interface Transaction {
  id: string;
  /** ISO date string, YYYY-MM-DD. */
  date: string;
  /** Always positive; use `direction` for sign. */
  amount: number;
  currency: string;
  direction: Direction;
  /** Normalized spending/income category (e.g. "groceries", "salary"). */
  category: string;
  description: string;
  account?: string;
  /** The source file/path this transaction came from (provenance). */
  source: string;
  /** The original source row. */
  raw: RawRecord;
}

/** A portfolio position. */
export interface Holding {
  id: string;
  symbol: string;
  name: string;
  assetClass: AssetClass;
  quantity: number;
  price: number;
  /** Market value = quantity * price (or provided directly). */
  value: number;
  currency: string;
  /** The source file/path this holding came from (provenance). */
  source: string;
  raw: RawRecord;
}

/** The time window the data covers. */
export interface Period {
  start: string; // ISO date
  end: string; // ISO date
  /** Number of whole months spanned, minimum 1. */
  months: number;
}

/** Metadata about the model's provenance. */
export interface ModelMeta {
  sources: string[]; // file paths / names
  createdAt: string; // ISO timestamp (injected, not derived internally)
  rowCounts: { transactions: number; holdings: number };
}

/** The container passed through the analysis pipeline. */
export interface FinancialModel {
  transactions: Transaction[];
  holdings: Holding[];
  /**
   * The model's single currency, meaningful only when `currencies.length <= 1`.
   * When multiple currencies are present the analysis layer refuses to run (see
   * `assertSingleCurrencyModel`); this field then holds the most frequent code purely
   * for reporting.
   */
  currency: string;
  /** Every distinct currency present across transactions + holdings, first-seen order. */
  currencies: string[];
  period: Period;
  meta: ModelMeta;
}

/** Compute the covered period from a set of ISO date strings. */
export function periodFromDates(dates: string[]): Period {
  const valid = dates.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  const start = valid[0] ?? "1970-01-01";
  const end = valid[valid.length - 1] ?? start;
  return { start, end, months: monthsBetween(start, end) };
}

/** Whole months between two ISO dates, minimum 1. */
export function monthsBetween(startIso: string, endIso: string): number {
  const [sy, sm] = startIso.split("-").map(Number) as [number, number];
  const [ey, em] = endIso.split("-").map(Number) as [number, number];
  const months = (ey - sy) * 12 + (em - sm) + 1;
  return Math.max(1, months);
}

/** Extract the YYYY-MM month key from an ISO date. */
export function monthKey(isoDate: string): string {
  return isoDate.slice(0, 7);
}

/** Convenience: total inflow across transactions. */
export function totalInflow(txns: Transaction[]): number {
  return txns
    .filter((t) => t.direction === "inflow")
    .reduce((a, t) => a + t.amount, 0);
}

/** Convenience: total outflow across transactions. */
export function totalOutflow(txns: Transaction[]): number {
  return txns
    .filter((t) => t.direction === "outflow")
    .reduce((a, t) => a + t.amount, 0);
}

/** Total portfolio value across holdings. */
export function totalPortfolioValue(holdings: Holding[]): number {
  return holdings.reduce((a, h) => a + h.value, 0);
}
