import type { FinancialModel, Transaction } from "../core/model.js";
import { formatMoney, median } from "../core/money.js";
import { metric, type AnalysisResult, type Finding } from "../core/result.js";

/**
 * Anomaly detection over outflow amounts using the Median Absolute Deviation (MAD),
 * which is robust to the very outliers we are trying to find (unlike mean/stddev).
 * A transaction is flagged when its modified z-score exceeds `threshold`.
 */
export function analyzeAnomalies(
  model: FinancialModel,
  threshold = 3.5,
): AnalysisResult {
  const cur = model.currency;
  const outflows = model.transactions.filter((t) => t.direction === "outflow");
  const amounts = outflows.map((t) => t.amount);
  const findings: Finding[] = [];

  if (outflows.length < 5) {
    return {
      module: "anomaly",
      title: "Anomalies",
      metrics: [metric("anomalies", "Anomalies found", 0, "count")],
      findings: [
        { severity: "info", message: "Too few transactions for reliable anomaly detection.", evidence: [] },
      ],
      evidence: [],
    };
  }

  // Recurring commitments (an identical amount appearing 3+ times — e.g. rent, a
  // subscription) are regular by definition, not anomalies. We both exclude them as
  // candidates AND compute the baseline from the remaining *variable* spend, so a large
  // fixed cost like rent doesn't inflate the baseline and mask a genuine one-off.
  const recurring = recurringAmounts(amounts, 3);
  const variable = outflows.filter((t) => !recurring.has(roundKey(t.amount)));
  const variableAmounts = variable.map((t) => t.amount);

  const med = median(variableAmounts);
  const mad = median(variableAmounts.map((a) => Math.abs(a - med))) || 1e-9;

  const scored = variable
    .map((t) => ({ t, z: (0.6745 * (t.amount - med)) / mad }))
    .filter((s) => s.z > threshold)
    .sort((a, b) => b.z - a.z);

  for (const s of scored.slice(0, 8)) {
    findings.push({
      severity: s.z > threshold * 1.7 ? "warning" : "notice",
      message: `Unusually large ${s.t.category} charge of ${formatMoney(s.t.amount, cur)} on ${s.t.date} (${s.z.toFixed(1)}× typical).`,
      evidence: [
        { label: s.t.description, detail: `${formatMoney(s.t.amount, cur)} on ${s.t.date}`, value: s.t.amount },
        { label: "typical (median)", detail: formatMoney(med, cur), value: med },
      ],
    });
  }

  return {
    module: "anomaly",
    title: "Anomalies",
    metrics: [
      metric("anomalies", "Anomalies found", scored.length, "count"),
      metric("medianOutflow", "Median outflow", med, "currency"),
      metric("largest", "Largest outflow", largestAmount(outflows), "currency"),
    ],
    findings,
    evidence: scored.slice(0, 8).map((s) => ({
      label: `${s.t.date} ${s.t.description}`,
      detail: `${formatMoney(s.t.amount, cur)} (${s.z.toFixed(1)}× typical)`,
      value: s.t.amount,
    })),
  };
}

function largestAmount(txns: Transaction[]): number {
  return txns.reduce((max, t) => Math.max(max, t.amount), 0);
}

function roundKey(amount: number): string {
  return amount.toFixed(2);
}

/** Amounts (rounded) that recur at least `minCount` times — treated as regular. */
function recurringAmounts(amounts: number[], minCount: number): Set<string> {
  const counts = new Map<string, number>();
  for (const a of amounts) {
    const k = roundKey(a);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const recurring = new Set<string>();
  for (const [k, c] of counts) if (c >= minCount) recurring.add(k);
  return recurring;
}
