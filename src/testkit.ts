/**
 * Shared test helpers (excluded from the production build in tsconfig). Keeps adversarial
 * tests concise: build models/tables in-memory and write temporary fixture files.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  periodFromDates,
  type AssetClass,
  type FinancialModel,
  type Holding,
  type RawRecord,
  type Transaction,
} from "./core/model.js";
import { distinctCurrencies } from "./core/currency.js";
import type { RawTable, TableShape } from "./ingestion/types.js";

let idSeq = 0;

/** Build a Transaction. Positive amount => inflow, negative => outflow. */
export function makeTxn(
  date: string,
  signedAmount: number,
  category = "misc",
  opts: { currency?: string; description?: string; source?: string } = {},
): Transaction {
  return {
    id: `tk${idSeq++}`,
    date,
    amount: Math.abs(signedAmount),
    currency: opts.currency ?? "USD",
    direction: signedAmount >= 0 ? "inflow" : "outflow",
    category,
    description: opts.description ?? category,
    source: opts.source ?? "test",
    raw: {},
  };
}

/** Build a Holding. */
export function makeHolding(
  symbol: string,
  value: number,
  assetClass: AssetClass = "equity",
  currency = "USD",
): Holding {
  return {
    id: `tk${idSeq++}`,
    symbol,
    name: symbol,
    assetClass,
    quantity: 1,
    price: value,
    value,
    currency,
    source: "test",
    raw: {},
  };
}

/** Assemble a FinancialModel from transactions/holdings, deriving period + currencies. */
export function makeModel(
  transactions: Transaction[],
  holdings: Holding[] = [],
): FinancialModel {
  const dates = transactions.map((t) => t.date);
  const currencies = distinctCurrencies([...transactions, ...holdings]);
  return {
    transactions,
    holdings,
    currency: currencies[0] ?? "USD",
    currencies,
    period: periodFromDates(dates.length ? dates : ["2024-01-01"]),
    meta: {
      sources: ["test"],
      createdAt: "2024-01-01T00:00:00Z",
      rowCounts: { transactions: transactions.length, holdings: holdings.length },
    },
  };
}

/** Build a RawTable for normalization tests. */
export function rawTable(
  rows: RawRecord[],
  headers: string[],
  shape: TableShape = "transactions",
  source = "test.csv",
): RawTable {
  return { name: source, source, headers, rows, shape };
}

/** Write CSV content to a fresh temp directory and return the file path. */
export function writeTempCsv(fileName: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "forge-test-"));
  const path = join(dir, fileName);
  writeFileSync(path, content, "utf8");
  return path;
}
