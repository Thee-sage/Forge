import type { AssetClass, Holding } from "../core/model.js";
import { parseAmount } from "../core/money.js";
import { normalizeCurrencyCode } from "../core/currency.js";
import type { RawTable } from "../ingestion/types.js";
import { cellString, HOLDING_ALIASES, resolveColumns } from "./columns.js";
import type { SkippedRow } from "./skipped.js";

export interface NormalizeHoldingResult {
  holdings: Holding[];
  warnings: string[];
  skipped: number;
  skippedDetails: SkippedRow[];
}

/** Map a free-text asset-class/sector label onto a canonical AssetClass. */
export function classifyAssetClass(raw: string): AssetClass {
  const t = raw.toLowerCase();
  if (/equit|stock|share|etf|fund/.test(t)) return "equity";
  if (/bond|fixed|treasur|gilt|debt|note/.test(t)) return "fixed_income";
  if (/cash|money market|savings|deposit/.test(t)) return "cash";
  if (/real estate|reit|property/.test(t)) return "real_estate";
  if (/gold|silver|oil|commodit|metal/.test(t)) return "commodity";
  if (/crypto|bitcoin|btc|eth|token/.test(t)) return "crypto";
  if (/hedge|private|alternative|venture/.test(t)) return "alternative";
  return "unknown";
}

/**
 * Normalize a holdings RawTable into unified `Holding`s.
 * Value is taken directly when present, else derived from quantity * price. Rows without
 * a positive value are recorded in `skippedDetails` — no silent loss.
 */
export function normalizeHoldings(
  table: RawTable,
  defaultCurrency: string,
): NormalizeHoldingResult {
  const cols = resolveColumns(table.headers, HOLDING_ALIASES);
  const warnings: string[] = [];
  const holdings: Holding[] = [];
  const skippedDetails: SkippedRow[] = [];

  if (!cols.value && !(cols.quantity && cols.price)) {
    warnings.push(
      `Table "${table.name}": holdings need a value column or quantity+price; skipping table.`,
    );
    const details = table.rows.map((_, i) => ({
      table: table.name,
      source: table.source,
      row: i,
      reason: "no value column and no quantity+price to derive it",
    }));
    return { holdings, warnings, skipped: details.length, skippedDetails: details };
  }

  table.rows.forEach((row, i) => {
    const symbol = cellString(row, cols.symbol);
    const name = cellString(row, cols.name) || symbol || "(unnamed)";
    const quantity = parseAmount(row[cols.quantity ?? ""]) ?? 0;
    const price = parseAmount(row[cols.price ?? ""]) ?? 0;
    let value = parseAmount(row[cols.value ?? ""]);
    if (value === undefined) value = quantity * price;

    if (!value || value <= 0) {
      skippedDetails.push({
        table: table.name,
        source: table.source,
        row: i,
        reason:
          value !== undefined && value < 0
            ? "negative holding value (short positions unsupported)"
            : "missing or non-positive holding value",
      });
      return;
    }

    const assetClassRaw = cellString(row, cols.assetClass);
    const assetClass = classifyAssetClass(assetClassRaw || name);
    const currency =
      normalizeCurrencyCode(cellString(row, cols.currency)) ?? defaultCurrency;

    holdings.push({
      id: `${table.name}#${i}`,
      symbol: symbol || name,
      name,
      assetClass,
      quantity,
      price,
      value,
      currency,
      source: table.source,
      raw: row,
    });
  });

  if (skippedDetails.length > 0) {
    warnings.push(
      `Table "${table.name}": skipped ${skippedDetails.length} holding row(s) with no positive value.`,
    );
  }

  return {
    holdings,
    warnings,
    skipped: skippedDetails.length,
    skippedDetails,
  };
}
