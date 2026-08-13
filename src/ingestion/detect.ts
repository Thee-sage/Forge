import type { RawRecord } from "../core/model.js";
import type { TableShape } from "./types.js";

/**
 * Detect whether a table holds transactions or portfolio holdings, based on its headers.
 * Heuristic and additive — extend the keyword sets rather than rewriting the logic.
 */

const HOLDING_HINTS = [
  "symbol",
  "ticker",
  "isin",
  "quantity",
  "shares",
  "units",
  "price",
  "market value",
  "marketvalue",
  "asset class",
  "assetclass",
  "holding",
  "position",
  "cusip",
];

const TRANSACTION_HINTS = [
  "date",
  "amount",
  "debit",
  "credit",
  "description",
  "category",
  "payee",
  "merchant",
  "balance",
  "transaction",
  "withdrawal",
  "deposit",
];

/** Score how well a header set matches a hint list. */
function scoreHeaders(headers: string[], hints: string[]): number {
  const lower = headers.map((h) => h.toLowerCase().trim());
  let score = 0;
  for (const hint of hints) {
    if (lower.some((h) => h.includes(hint))) score += 1;
  }
  return score;
}

/** Decide the shape of a table from its headers. */
export function detectShape(headers: string[]): TableShape {
  const holdingScore = scoreHeaders(headers, HOLDING_HINTS);
  const txnScore = scoreHeaders(headers, TRANSACTION_HINTS);

  // Require at least a minimal signal, else "unknown".
  if (holdingScore === 0 && txnScore === 0) return "unknown";
  if (holdingScore > txnScore) return "holdings";
  if (txnScore > holdingScore) return "transactions";
  // Tie: presence of a quantity/price pair tips toward holdings.
  const hasQtyPrice =
    scoreHeaders(headers, ["quantity", "shares", "units"]) > 0 &&
    scoreHeaders(headers, ["price"]) > 0;
  return hasQtyPrice ? "holdings" : "transactions";
}

/** Extract header keys from the first row of records (fallback when headers are absent). */
export function headersFromRows(rows: RawRecord[]): string[] {
  const first = rows[0];
  return first ? Object.keys(first) : [];
}
