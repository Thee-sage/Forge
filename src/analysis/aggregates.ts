import {
  monthKey,
  type FinancialModel,
  type Transaction,
} from "../core/model.js";
import { sum } from "../core/money.js";

/**
 * Reusable aggregations over the unified model. Kept separate so multiple analysis
 * modules share one definition of "monthly cash flow", "spend by category", etc.
 */

export interface MonthlyFlow {
  month: string; // YYYY-MM
  inflow: number;
  outflow: number;
  net: number;
}

/** Group transactions into monthly inflow/outflow/net buckets, sorted by month. */
export function monthlyFlows(txns: Transaction[]): MonthlyFlow[] {
  const map = new Map<string, MonthlyFlow>();
  for (const t of txns) {
    const key = monthKey(t.date);
    const bucket = map.get(key) ?? { month: key, inflow: 0, outflow: 0, net: 0 };
    if (t.direction === "inflow") bucket.inflow += t.amount;
    else bucket.outflow += t.amount;
    bucket.net = bucket.inflow - bucket.outflow;
    map.set(key, bucket);
  }
  return [...map.values()].sort((a, b) => a.month.localeCompare(b.month));
}

/** Sum outflow amount per category, sorted descending by amount. */
export function spendByCategory(txns: Transaction[]): { category: string; amount: number }[] {
  const map = new Map<string, number>();
  for (const t of txns) {
    if (t.direction !== "outflow") continue;
    map.set(t.category, (map.get(t.category) ?? 0) + t.amount);
  }
  return [...map.entries()]
    .map(([category, amount]) => ({ category, amount }))
    .sort((a, b) => b.amount - a.amount);
}

/** All outflow amounts (positive numbers). */
export function outflowAmounts(txns: Transaction[]): number[] {
  return txns.filter((t) => t.direction === "outflow").map((t) => t.amount);
}

/** Total inflow / outflow / net for the whole model. */
export function totals(model: FinancialModel): {
  inflow: number;
  outflow: number;
  net: number;
} {
  const inflow = sum(
    model.transactions.filter((t) => t.direction === "inflow").map((t) => t.amount),
  );
  const outflow = sum(
    model.transactions.filter((t) => t.direction === "outflow").map((t) => t.amount),
  );
  return { inflow, outflow, net: inflow - outflow };
}
