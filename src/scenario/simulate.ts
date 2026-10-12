import {
  monthKey,
  periodFromDates,
  type FinancialModel,
  type Transaction,
} from "../core/model.js";
import { findMetric, type AnalysisResult } from "../core/result.js";
import { ForgeError } from "../core/errors.js";
import { runAnalyses } from "../analysis/index.js";

/**
 * Scenario simulation (ARCHITECTURE.md §7). A scenario clones the model, applies a
 * transform, re-runs the full analysis pipeline, and diffs key metrics against the
 * baseline — producing a projected impact plus a reasoned explanation.
 */
export interface ScenarioSpec {
  /** Fractional change to all income, e.g. -0.2 for a 20% pay cut. */
  incomePct?: number;
  /** Fractional change to all spending, e.g. 0.1 for 10% higher costs. */
  expensePct?: number;
  /** A new recurring monthly expense. */
  recurringExpense?: { amount: number; category: string; label?: string };
  /** A single one-off expense. */
  oneOffExpense?: { amount: number; category: string; label?: string };
}

export interface MetricDelta {
  key: string;
  label: string;
  baseline: number;
  scenario: number;
  delta: number;
  unit?: string;
}

/** Thrown for a scenario that cannot be simulated (non-finite or out-of-range inputs). */
export class ScenarioError extends ForgeError {}

/** A tracked metric with no delta because it was not available on one side of the comparison. */
export interface UnavailableDelta {
  key: string;
  label: string;
  reason: string;
}

export interface ScenarioResult {
  spec: ScenarioSpec;
  description: string;
  /** Only metrics that are available in BOTH the baseline and the scenario; see `unavailable`. */
  deltas: MetricDelta[];
  /** Tracked metrics omitted from `deltas` because a value was missing (never reported as 0). */
  unavailable: UnavailableDelta[];
  scenarioResults: AnalysisResult[];
  explanation: string;
}

const TRACKED: { module: string; key: string; label: string; unit: string }[] = [
  { module: "health", key: "score", label: "Health score", unit: "score" },
  { module: "cashflow", key: "net", label: "Net cash flow", unit: "currency" },
  { module: "cashflow", key: "savingsRate", label: "Savings rate", unit: "percent" },
  { module: "cashflow", key: "avgMonthlyNet", label: "Avg monthly net", unit: "currency" },
  { module: "health", key: "runwayMonths", label: "Cash runway (months)", unit: "count" },
];

/**
 * Reject scenario inputs that cannot describe a real change. A percentage below -100% would turn
 * amounts negative (breaking "amount is always >= 0", DATA_MODEL C2) and a non-finite value would
 * poison every total, so both fail clearly instead of producing a plausible-looking result.
 */
export function validateScenario(spec: ScenarioSpec): void {
  const pct = (name: string, v: number | undefined): void => {
    if (v === undefined) return;
    if (!Number.isFinite(v)) throw new ScenarioError(`Invalid scenario: ${name} must be a finite number (got ${v}).`);
    if (v < -1) throw new ScenarioError(`Invalid scenario: ${name} of ${v * 100}% would make amounts negative; the lowest allowed change is -100%.`);
  };
  pct("income change", spec.incomePct);
  pct("expense change", spec.expensePct);
  const amount = (name: string, e: { amount: number } | undefined): void => {
    if (e === undefined) return;
    if (!Number.isFinite(e.amount) || e.amount < 0) throw new ScenarioError(`Invalid scenario: ${name} must be a finite, non-negative amount (got ${e.amount}).`);
  };
  amount("recurring expense", spec.recurringExpense);
  amount("one-off expense", spec.oneOffExpense);
}

/** Apply a scenario transform and return a new model (the original is untouched). */
export function applyScenario(model: FinancialModel, spec: ScenarioSpec): FinancialModel {
  validateScenario(spec);
  let transactions: Transaction[] = model.transactions.map((t) => {
    let amount = t.amount;
    if (t.direction === "inflow" && spec.incomePct) amount *= 1 + spec.incomePct;
    if (t.direction === "outflow" && spec.expensePct) amount *= 1 + spec.expensePct;
    return { ...t, amount };
  });

  // Recurring expense: one synthetic outflow per covered month.
  if (spec.recurringExpense && spec.recurringExpense.amount > 0) {
    const months = [...new Set(model.transactions.map((t) => monthKey(t.date)))].sort();
    const { amount, category, label } = spec.recurringExpense;
    months.forEach((mk, i) => {
      transactions.push(synthetic(`scenario-recur#${i}`, `${mk}-15`, amount, category, label ?? "scenario recurring expense", model.currency));
    });
  }

  // One-off expense: a single synthetic outflow at the end of the period.
  if (spec.oneOffExpense && spec.oneOffExpense.amount > 0) {
    const { amount, category, label } = spec.oneOffExpense;
    transactions.push(synthetic("scenario-oneoff#0", model.period.end, amount, category, label ?? "scenario one-off expense", model.currency));
  }

  const dates = transactions.map((t) => t.date);
  return {
    ...model,
    transactions,
    period: periodFromDates(dates.length ? dates : [model.period.start, model.period.end]),
    meta: { ...model.meta, rowCounts: { ...model.meta.rowCounts, transactions: transactions.length } },
  };
}

/** Run a scenario end-to-end and diff against the baseline analysis. */
export function simulate(
  model: FinancialModel,
  spec: ScenarioSpec,
  baseline?: AnalysisResult[],
): ScenarioResult {
  const base = baseline ?? runAnalyses(model);
  const scenarioModel = applyScenario(model, spec);
  const scenarioResults = runAnalyses(scenarioModel);

  // A metric Forge declined to compute is UNAVAILABLE, not zero: comparing against a fabricated
  // 0 would report (for example) a runway "improvement" from nothing to twelve months.
  const deltas: MetricDelta[] = [];
  const unavailable: UnavailableDelta[] = [];
  for (const t of TRACKED) {
    const b = available(base, t.module, t.key);
    const s = available(scenarioResults, t.module, t.key);
    const key = `${t.module}.${t.key}`;
    if (b === undefined || s === undefined) {
      unavailable.push({
        key,
        label: t.label,
        reason: b === undefined ? "was not available for the baseline, so no change can be reported" : "is not available for the scenario",
      });
      continue;
    }
    deltas.push({ key, label: t.label, baseline: b, scenario: s, delta: s - b, unit: t.unit });
  }

  return {
    spec,
    description: describeScenario(spec),
    deltas,
    unavailable,
    scenarioResults,
    explanation: explain(deltas, unavailable, spec),
  };
}

/** A tracked metric's value, or undefined when it is missing or not measurable (savings rate needs income). */
function available(results: AnalysisResult[], module: string, key: string): number | undefined {
  const value = findMetric(results, module, key);
  if (value === undefined) return undefined;
  if (key === "savingsRate" && (findMetric(results, "cashflow", "inflow") ?? 0) <= 0) return undefined;
  return value;
}

function synthetic(
  id: string,
  date: string,
  amount: number,
  category: string,
  description: string,
  currency: string,
): Transaction {
  return {
    id,
    date,
    amount,
    currency,
    direction: "outflow",
    category: category.toLowerCase(),
    description,
    source: "scenario",
    raw: { synthetic: true },
  };
}

/** Human-readable one-liner for a scenario spec. */
export function describeScenario(spec: ScenarioSpec): string {
  const parts: string[] = [];
  if (spec.incomePct) parts.push(`income ${signed(spec.incomePct * 100)}%`);
  if (spec.expensePct) parts.push(`expenses ${signed(spec.expensePct * 100)}%`);
  if (spec.recurringExpense) parts.push(`+${spec.recurringExpense.amount}/mo ${spec.recurringExpense.category}`);
  if (spec.oneOffExpense) parts.push(`one-off ${spec.oneOffExpense.amount} ${spec.oneOffExpense.category}`);
  return parts.length ? parts.join(", ") : "no change";
}

function explain(deltas: MetricDelta[], unavailable: UnavailableDelta[], spec: ScenarioSpec): string {
  const score = deltas.find((d) => d.key === "health.score");
  const net = deltas.find((d) => d.key === "cashflow.net");
  const savings = deltas.find((d) => d.key === "cashflow.savingsRate");
  const bits: string[] = [];
  const noScore = unavailable.find((u) => u.key === "health.score");
  if (noScore) bits.push(`health score ${noScore.reason}`);
  if (score) {
    const dir = score.delta > 0 ? "improves" : score.delta < 0 ? "worsens" : "is unchanged";
    bits.push(`health score ${dir} by ${Math.abs(Math.round(score.delta))} point(s) to ${Math.round(score.scenario)}/100`);
  }
  if (net && Math.abs(net.delta) >= 1) {
    bits.push(`net cash flow moves by ${net.delta > 0 ? "+" : ""}${Math.round(net.delta)}`);
  }
  if (savings && Math.abs(savings.delta) >= 0.005) {
    bits.push(`savings rate shifts ${savings.delta > 0 ? "+" : ""}${(savings.delta * 100).toFixed(1)} pts`);
  }
  const lead = `Under "${describeScenario(spec)}", `;
  return bits.length ? lead + bits.join("; ") + "." : lead + "key metrics are essentially unchanged.";
}

function signed(n: number): string {
  return `${n > 0 ? "+" : ""}${Math.round(n)}`;
}
