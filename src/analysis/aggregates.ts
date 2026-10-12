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

/** One half of a period-over-period comparison. */
export interface HalfWindow {
  /** Month keys covered by this half, in order. */
  months: string[];
  inflow: number;
  outflow: number;
  net: number;
  /** net / inflow; 0 when there was no inflow. */
  savingsRate: number;
  /** The lowest monthly net in the window; 0 when the window is empty. */
  lowestNet: number;
}

/**
 * Split a monthly series into an earlier and a recent half and total each side.
 *
 * The engine owns this derivation so that a period-over-period table is computed once,
 * the same way, wherever it is shown (ARCHITECTURE.md §1). Returns `undefined` when
 * there are fewer than two months, because a comparison would be meaningless.
 */
export function periodHalves(
  flows: MonthlyFlow[],
): { earlier: HalfWindow; recent: HalfWindow } | undefined {
  if (flows.length < 2) return undefined;
  const mid = Math.floor(flows.length / 2);
  return {
    earlier: halfWindow(flows.slice(0, mid)),
    recent: halfWindow(flows.slice(mid)),
  };
}

function halfWindow(flows: MonthlyFlow[]): HalfWindow {
  const inflow = flows.reduce((a, f) => a + f.inflow, 0);
  const outflow = flows.reduce((a, f) => a + f.outflow, 0);
  const net = inflow - outflow;
  return {
    months: flows.map((f) => f.month),
    inflow,
    outflow,
    net,
    savingsRate: inflow === 0 ? 0 : net / inflow,
    lowestNet: flows.length === 0 ? 0 : Math.min(...flows.map((f) => f.net)),
  };
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
