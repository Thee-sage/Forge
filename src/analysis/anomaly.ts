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

  // A commitment does not stop being regular because its amount drifts. Groceries at 430,
  // 437, 445, 452 … recur every month as surely as a fixed rent, but no two amounts are
  // identical, so the rule above never saw them — and because such a category is often
  // several times larger than a household's small discretionary spend, every month of it
  // was reported as an anomaly (D22). A transaction is therefore also regular when it sits
  // within the ordinary spread of its own recurring category, judged by the same modified
  // z-score and the same threshold used for the portfolio-wide comparison.
  //
  // Only candidacy is narrowed here, never the baseline: an ordinary household's categories
  // are nearly all monthly, so removing them from the baseline as well would leave too few
  // amounts to form one. Keeping them is the conservative direction — it raises the median
  // and flags less, so this cannot manufacture an anomaly.
  const regularInOwnCategory = regularMembersOfRecurringCategories(variable, threshold);

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
    .filter((t) => !regularInOwnCategory.has(t))
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

/**
 * Transactions that are ordinary for their own category, where that category is itself a
 * recurring commitment: it appears in at least three distinct months, the same minimum the
 * identical-amount rule uses. "Ordinary" is the same modified z-score and threshold applied
 * within the category, so a genuine blow-out inside a recurring category (a 2,600 grocery
 * order among 450s) is still a candidate, while the 450s are not.
 *
 * Membership is returned by identity, not by amount, so two equal amounts in different
 * categories are judged separately.
 */
function regularMembersOfRecurringCategories(
  variable: Transaction[],
  threshold: number,
): Set<Transaction> {
  const byCategory = new Map<string, Transaction[]>();
  for (const t of variable) {
    const group = byCategory.get(t.category);
    if (group) group.push(t);
    else byCategory.set(t.category, [t]);
  }

  const regular = new Set<Transaction>();
  for (const group of byCategory.values()) {
    const months = new Set(group.map((t) => t.date.slice(0, 7)));
    if (months.size < 3) continue;
    const groupAmounts = group.map((t) => t.amount);
    const groupMedian = median(groupAmounts);
    const groupDeviations = groupAmounts.map((a) => Math.abs(a - groupMedian));
    const groupMad = median(groupDeviations);
    const groupMeanAd = mean(groupDeviations);
    for (const t of group) {
      const z =
        groupMad > 0
          ? (0.6745 * (t.amount - groupMedian)) / groupMad
          : groupMeanAd > 0
            ? (t.amount - groupMedian) / (1.253314 * groupMeanAd)
            : 0;
      if (z <= threshold) regular.add(t);
    }
  }
  return regular;
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
