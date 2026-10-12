import type { AssetClass, Holding } from "../core/model.js";
import { parseAmount } from "../core/money.js";
import { currencyInAmountText, normalizeCurrencyCode } from "../core/currency.js";
import type { RawTable } from "../ingestion/types.js";
import { cellString, HOLDING_ALIASES, resolveColumns } from "./columns.js";
import type { SkippedRow } from "./skipped.js";

export interface NormalizeHoldingResult {
  holdings: Holding[];
  warnings: string[];
  skipped: number;
  skippedDetails: SkippedRow[];
}

/**
 * Map a free-text asset-class/sector label onto a canonical AssetClass.
 *
 * Order matters. Specific classes are tested before the generic wrappers "fund" / "ETF", which
 * only decide when nothing more specific matched: a "Money Market Fund" is cash, a "Bond ETF" is
 * fixed income, a "Gold ETF" is a commodity and a "Hedge Fund" / "Private Equity" holding is
 * alternative (none of them plain equity).
 */
export function classifyAssetClass(raw: string): AssetClass {
  const t = raw.toLowerCase();
  if (/hedge|private equity|private|venture|alternative/.test(t)) return "alternative";
  if (/equit|stock|share/.test(t)) return "equity";
  if (/bond|fixed|treasur|gilt|debt|note/.test(t)) return "fixed_income";
  if (/cash|money market|savings|deposit/.test(t)) return "cash";
  if (/real[ _-]?estate|reit|property/.test(t)) return "real_estate";
  if (/gold|silver|oil|commodit|metal/.test(t)) return "commodity";
  if (/crypto|bitcoin|btc|eth|token/.test(t)) return "crypto";
  if (/etf|fund/.test(t)) return "equity";
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

  const inconsistent: string[] = [];
  const unrecognisedCurrencies = new Set<string>();

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

    // A stated value that disagrees with quantity x price is contradictory: the stated value is
    // used (it is what the source calls the market value) but the conflict is reported.
    if (parseAmount(row[cols.value ?? ""]) !== undefined && quantity > 0 && price > 0) {
      const implied = quantity * price;
      if (Math.abs(value - implied) > Math.max(0.01, 0.005 * Math.max(value, implied))) {
        inconsistent.push(`${symbol || name} (value ${value} vs ${quantity} x ${price} = ${implied})`);
      }
    }

    const assetClassRaw = cellString(row, cols.assetClass);
    const assetClass = classifyAssetClass(assetClassRaw || name);
    const currencyCell = cellString(row, cols.currency);
    const cellCode = normalizeCurrencyCode(currencyCell);
    if (currencyCell !== "" && cellCode === undefined) unrecognisedCurrencies.add(currencyCell);
    const currency =
      cellCode ??
      currencyInAmountText(row[cols.value ?? ""]) ??
      currencyInAmountText(row[cols.price ?? ""]) ??
      defaultCurrency;

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

  if (inconsistent.length > 0) {
    warnings.push(
      `Table "${table.name}": ${inconsistent.length} holding(s) have a stated value that contradicts quantity x price (${inconsistent.slice(0, 3).join("; ")}); the stated value was used. Verify the source.`,
    );
  }
  if (unrecognisedCurrencies.size > 0) {
    warnings.push(
      `Table "${table.name}": unrecognised currency value(s) ${[...unrecognisedCurrencies].slice(0, 3).map((c) => `"${c}"`).join(", ")}; those holdings are assumed to be ${defaultCurrency}. Verify the currency before relying on totals.`,
    );
  }

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
