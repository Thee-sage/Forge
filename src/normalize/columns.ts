import type { RawRecord } from "../core/model.js";

/**
 * Column alias resolution. Heterogeneous sources name the same concept differently
 * ("Amount", "amt", "Value"); these maps let normalization find the right cell without
 * every adapter re-implementing header matching (ARCHITECTURE.md §3, normalize/).
 */

/** Canonical fields we try to locate in a transaction table. */
export const TRANSACTION_ALIASES: Record<string, string[]> = {
  date: ["date", "transaction date", "posted date", "posting date", "trans date", "value date"],
  amount: ["amount", "amt", "value", "transaction amount"],
  debit: ["debit", "withdrawal", "withdrawals", "money out", "paid out", "expense", "expenses", "outflow"],
  credit: ["credit", "deposit", "deposits", "money in", "paid in", "income", "inflow"],
  description: ["description", "details", "narrative", "memo", "payee", "merchant", "name", "particulars"],
  category: ["category", "type", "class", "tag"],
  account: ["account", "account name", "account number", "acct"],
  currency: ["currency", "ccy", "curr"],
  balance: ["balance", "running balance", "closing balance"],
};

/** Canonical fields we try to locate in a holdings table. */
export const HOLDING_ALIASES: Record<string, string[]> = {
  symbol: ["symbol", "ticker", "isin", "cusip", "code"],
  name: ["name", "security", "security name", "description", "holding", "instrument"],
  assetClass: ["asset class", "assetclass", "class", "type", "category", "sector"],
  quantity: ["quantity", "qty", "shares", "units", "position"],
  price: ["price", "unit price", "last price", "market price", "nav"],
  value: ["value", "market value", "marketvalue", "amount", "total value", "current value"],
  currency: ["currency", "ccy", "curr"],
};

/** Build a lookup from lowercased header -> original header for a row's keys. */
export function headerIndex(headers: string[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const h of headers) {
    map.set(h.toLowerCase().trim(), h);
  }
  return map;
}

/**
 * Resolve which actual header (if any) maps to a canonical field.
 * Tries exact alias match first, then substring containment.
 */
export function resolveColumn(
  headers: string[],
  aliases: string[],
): string | undefined {
  const index = headerIndex(headers);
  // Exact match.
  for (const alias of aliases) {
    const hit = index.get(alias);
    if (hit) return hit;
  }
  // Substring containment (header contains alias or vice-versa).
  for (const [lower, original] of index) {
    for (const alias of aliases) {
      if (lower.includes(alias) || alias.includes(lower)) return original;
    }
  }
  return undefined;
}

/** Resolve every canonical field in an alias map to actual headers. */
export function resolveColumns(
  headers: string[],
  aliasMap: Record<string, string[]>,
): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [canonical, aliases] of Object.entries(aliasMap)) {
    out[canonical] = resolveColumn(headers, aliases);
  }
  return out;
}

/** Read a cell from a row given the resolved header (may be undefined). */
export function cell(row: RawRecord, header: string | undefined): unknown {
  if (header === undefined) return undefined;
  return row[header];
}

/** Coerce any cell to a trimmed string ("" when null/undefined). */
export function cellString(row: RawRecord, header: string | undefined): string {
  const v = cell(row, header);
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).trim();
}
