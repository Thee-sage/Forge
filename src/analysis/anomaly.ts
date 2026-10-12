import type { FinancialModel, Transaction } from "../core/model.js";
import { formatMoney, mean, median } from "../core/money.js";
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
  const deviations = variableAmounts.map((a) => Math.abs(a - med));
  const mad = median(deviations);
  // Modified z-score (Iglewicz & Hoaglin): 0.6745 (x - median) / MAD. When more than half of
  // the variable amounts are identical the MAD is 0 and the score is undefined; falling back to
  // the mean absolute deviation (z = (x - median) / (1.253314 * meanAD)) keeps it finite, and
  // when every amount is identical there is no spread at all, so nothing is an outlier.
  const meanAd = mean(deviations);
  const zOf = (amount: number): number =>
    mad > 0
      ? (0.6745 * (amount - med)) / mad
      : meanAd > 0
        ? (amount - med) / (1.253314 * meanAd)
        : 0;

  const scored = variable
    .map((t) => ({ t, z: zOf(t.amount) }))
    .filter((s) => s.z > threshold)
    .sort((a, b) => b.z - a.z);
  const ratioText = (amount: number): string => (med > 0 ? `${(amount / med).toFixed(1)}× the typical ${formatMoney(med, cur)} outflow; ` : "");

  for (const s of scored.slice(0, 8)) {
    findings.push({
      severity: s.z > threshold * 1.7 ? "warning" : "notice",
      message: `Unusually large ${s.t.category} charge of ${formatMoney(s.t.amount, cur)} on ${s.t.date} (${ratioText(s.t.amount)}modified z-score ${s.z.toFixed(1)}).`,
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
      detail: `${formatMoney(s.t.amount, cur)} (${ratioText(s.t.amount)}modified z-score ${s.z.toFixed(1)})`,
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
