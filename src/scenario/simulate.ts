import {
  monthKey,
  periodFromDates,
  type FinancialModel,
  type Transaction,
} from "../core/model.js";
import { findMetric, type AnalysisResult } from "../core/result.js";
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

export interface ScenarioResult {
  spec: ScenarioSpec;
  description: string;
  deltas: MetricDelta[];
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

/** Apply a scenario transform and return a new model (the original is untouched). */
export function applyScenario(model: FinancialModel, spec: ScenarioSpec): FinancialModel {
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

  const deltas: MetricDelta[] = TRACKED.map((t) => {
    const b = findMetric(base, t.module, t.key) ?? 0;
    const s = findMetric(scenarioResults, t.module, t.key) ?? 0;
    return { key: `${t.module}.${t.key}`, label: t.label, baseline: b, scenario: s, delta: s - b, unit: t.unit };
  });

  return {
    spec,
    description: describeScenario(spec),
    deltas,
    scenarioResults,
    explanation: explain(deltas, spec),
  };
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

function explain(deltas: MetricDelta[], spec: ScenarioSpec): string {
  const score = deltas.find((d) => d.key === "health.score");
  const net = deltas.find((d) => d.key === "cashflow.net");
  const savings = deltas.find((d) => d.key === "cashflow.savingsRate");
  const bits: string[] = [];
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
