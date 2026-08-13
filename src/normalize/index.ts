import {
  periodFromDates,
  type FinancialModel,
  type Holding,
  type Transaction,
} from "../core/model.js";
import { distinctCurrencies, normalizeCurrencyCode } from "../core/currency.js";
import type { RawTable } from "../ingestion/types.js";
import { normalizeHoldings } from "./holdings.js";
import { normalizeTransactions } from "./transactions.js";
import type { SkippedRow } from "./skipped.js";

export { classifyAssetClass } from "./holdings.js";
export { categorize } from "./categorize.js";
export { toIsoDate, inferDateOrder } from "./dates.js";
export type { SkippedRow } from "./skipped.js";

/** A transparency report emitted alongside the model (ARCHITECTURE.md §8). */
export interface NormalizationReport {
  tablesProcessed: number;
  transactionsParsed: number;
  holdingsParsed: number;
  rowsSkipped: number;
  /** Per-row explanations for every skipped row (capped for display in renderers). */
  skippedRows: SkippedRow[];
  warnings: string[];
  currenciesSeen: string[];
}

export interface NormalizationOutput {
  model: FinancialModel;
  report: NormalizationReport;
}

/**
 * Normalize a set of RawTables into one unified FinancialModel plus a report.
 * Note: this does not reject multi-currency inputs — that is the analysis layer's job
 * (`assertSingleCurrencyModel`). Normalization's contract is to surface what it saw.
 */
export function normalize(
  tables: RawTable[],
  options: { defaultCurrency?: string; now?: string } = {},
): NormalizationOutput {
  const defaultCurrency =
    normalizeCurrencyCode(options.defaultCurrency) ?? "USD";
  const transactions: Transaction[] = [];
  const holdings: Holding[] = [];
  const warnings: string[] = [];
  const skippedRows: SkippedRow[] = [];

  for (const table of tables) {
    const shape = table.shape;
    if (shape === "holdings") {
      const r = normalizeHoldings(table, defaultCurrency);
      holdings.push(...r.holdings);
      warnings.push(...r.warnings);
      skippedRows.push(...r.skippedDetails);
    } else if (shape === "transactions") {
      const r = normalizeTransactions(table, defaultCurrency);
      transactions.push(...r.transactions);
      warnings.push(...r.warnings);
      skippedRows.push(...r.skippedDetails);
    } else {
      // Unknown shape: try transactions first, fall back to holdings.
      const asTxn = normalizeTransactions(table, defaultCurrency);
      if (asTxn.transactions.length > 0) {
        transactions.push(...asTxn.transactions);
        warnings.push(...asTxn.warnings);
        skippedRows.push(...asTxn.skippedDetails);
      } else {
        const asHold = normalizeHoldings(table, defaultCurrency);
        holdings.push(...asHold.holdings);
        warnings.push(
          `Table "${table.name}": shape was ambiguous; interpreted as ${
            asHold.holdings.length > 0 ? "holdings" : "empty"
          }.`,
        );
        skippedRows.push(...asHold.skippedDetails);
      }
    }
  }

  const currenciesSeen = distinctCurrencies([...transactions, ...holdings]);
  const currency = dominantCurrency(transactions, holdings, defaultCurrency);
  if (currenciesSeen.length > 1) {
    warnings.push(
      `Multiple currencies detected (${currenciesSeen.join(
        ", ",
      )}). Forge does not FX-convert; analysis of a mixed-currency dataset will fail clearly.`,
    );
  }

  const dates = transactions.map((t) => t.date);
  const period = periodFromDates(dates);

  const model: FinancialModel = {
    transactions,
    holdings,
    currency,
    currencies: currenciesSeen,
    period,
    meta: {
      sources: [...new Set(tables.map((t) => t.source))],
      createdAt: options.now ?? new Date().toISOString(),
      rowCounts: {
        transactions: transactions.length,
        holdings: holdings.length,
      },
    },
  };

  const report: NormalizationReport = {
    tablesProcessed: tables.length,
    transactionsParsed: transactions.length,
    holdingsParsed: holdings.length,
    rowsSkipped: skippedRows.length,
    skippedRows,
    warnings,
    currenciesSeen,
  };

  return { model, report };
}

function dominantCurrency(
  txns: Transaction[],
  holdings: Holding[],
  fallback: string,
): string {
  const counts = new Map<string, number>();
  for (const t of txns) counts.set(t.currency, (counts.get(t.currency) ?? 0) + 1);
  for (const h of holdings) counts.set(h.currency, (counts.get(h.currency) ?? 0) + 1);
  let best = fallback;
  let bestCount = -1;
  for (const [cur, count] of counts) {
    if (count > bestCount) {
      best = cur;
      bestCount = count;
    }
  }
  return best;
}
