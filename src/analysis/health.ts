import { totalPortfolioValue, type FinancialModel } from "../core/model.js";
import { clamp, formatMoney, safeDiv } from "../core/money.js";
import { metric, type AnalysisResult, type Finding, type Metric, type Severity } from "../core/result.js";
import { monthlyFlows, totals } from "./aggregates.js";

/**
 * Financial health assessment (hardened — §2).
 *
 * Design principles:
 *  - **No fabricated sub-scores.** A dimension is scored only when the data required to
 *    assess it is present; the composite is a weighted average over *assessed* dimensions
 *    with weights renormalised, so absent data cannot inflate (or deflate) the score.
 *  - **No score without inputs.** With no assessable dimension, no numeric score is
 *    emitted — the module says so plainly instead of returning a misleading number.
 *  - **A critical risk cannot hide behind strong dimensions.** Severe conditions (spending
 *    exceeds income, sub-1-month runway, mostly-negative months) cap the score so the
 *    headline classification stays honest even when other dimensions are strong.
 */

interface Dimension {
  key: string;
  label: string;
  weight: number;
  score: number;
}

const WEIGHTS = {
  savings: 0.3,
  expense: 0.15,
  stability: 0.2,
  liquidity: 0.15,
  diversification: 0.2,
} as const;

export function analyzeHealth(model: FinancialModel): AnalysisResult {
  const cur = model.currency;
  const { inflow, outflow, net } = totals(model);
  const flows = monthlyFlows(model.transactions);
  const hasHoldings = model.holdings.length > 0;
  const total = totalPortfolioValue(model.holdings);

  const assessed: Dimension[] = [];
  const notAssessed: string[] = [];
  const metrics: Metric[] = [];

  // --- Savings & expense: require income to be meaningful.
  const savingsRate = safeDiv(net, inflow);
  const expenseRatio = safeDiv(outflow, inflow);
  if (inflow > 0) {
    const savingsScore = clamp(savingsRate / 0.2, 0, 1);
    const expenseScore = clamp(1 - (expenseRatio - 0.5) / 0.5, 0, 1);
    assessed.push({ key: "savings", label: "savings", weight: WEIGHTS.savings, score: savingsScore });
    assessed.push({ key: "expense", label: "expense discipline", weight: WEIGHTS.expense, score: expenseScore });
    metrics.push(metric("savingsScore", "Savings sub-score", savingsScore, "ratio"));
    metrics.push(metric("expenseScore", "Expense sub-score", expenseScore, "ratio"));
  } else {
    notAssessed.push("savings/expense (no income data)");
  }

  // --- Stability: requires at least two months to be a "trend" at all.
  const positiveMonths = flows.filter((f) => f.net >= 0).length;
  const positiveShare = flows.length > 0 ? positiveMonths / flows.length : 0;
  if (flows.length >= 2) {
    assessed.push({ key: "stability", label: "cash-flow stability", weight: WEIGHTS.stability, score: positiveShare });
    metrics.push(metric("stabilityScore", "Stability sub-score", positiveShare, "ratio"));
  } else {
    notAssessed.push("cash-flow stability (need ≥2 months)");
  }

  // --- Liquidity runway: requires holdings AND spending, in the same currency (already
  // guaranteed single-currency by the pipeline). cash / average monthly outflow.
  const cashValue = model.holdings.filter((h) => h.assetClass === "cash").reduce((a, h) => a + h.value, 0);
  const avgMonthlyOutflow = safeDiv(outflow, model.period.months);
  let runwayMonths: number | undefined;
  if (hasHoldings && outflow > 0) {
    runwayMonths = safeDiv(cashValue, avgMonthlyOutflow);
    const liquidityScore = clamp(runwayMonths / 6, 0, 1);
    assessed.push({ key: "liquidity", label: "liquidity runway", weight: WEIGHTS.liquidity, score: liquidityScore });
    metrics.push(metric("liquidityScore", "Liquidity sub-score", liquidityScore, "ratio"));
    metrics.push(metric("runwayMonths", "Cash runway (months)", runwayMonths, "count"));
  } else {
    notAssessed.push("liquidity runway (needs holdings + spending)");
  }

  // --- Diversification: requires holdings.
  if (hasHoldings && total > 0) {
    const hhi = model.holdings.reduce((acc, h) => acc + (h.value / total) ** 2, 0);
    const diversificationScore = clamp((1 - hhi) / 0.75, 0, 1);
    assessed.push({ key: "diversification", label: "diversification", weight: WEIGHTS.diversification, score: diversificationScore });
    metrics.push(metric("diversificationScore", "Diversification sub-score", diversificationScore, "ratio"));
  } else {
    notAssessed.push("diversification (no holdings)");
  }

  metrics.unshift(metric("assessedDimensions", "Dimensions assessed", assessed.length, "count"));

  const findings: Finding[] = [];

  // A "financial health" score is meaningful only with cash-flow data. Without income we
  // refuse to invent a headline score (it would mislead), reporting only what we can.
  const canScore = inflow > 0;
  if (!canScore) {
    findings.push({
      severity: "info",
      message:
        assessed.length > 0
          ? "No income/cash-flow data — a financial health score needs transactions; reporting available portfolio metrics only."
          : "Insufficient data to compute a financial health score (no income, holdings, or multi-month history).",
      evidence: [],
    });
    if (notAssessed.length > 0) {
      findings.push({ severity: "info", message: `Not assessed (data absent): ${notAssessed.join("; ")}.`, evidence: [] });
    }
    return { module: "health", title: "Financial Health", metrics, findings, evidence: [] };
  }

  // Weighted average over assessed dimensions only.
  const weightSum = assessed.reduce((a, d) => a + d.weight, 0);
  const rawScore = assessed.reduce((a, d) => a + d.score * d.weight, 0) / weightSum;

  // Critical-risk caps: a severe weakness limits the headline no matter how strong the
  // rest is (so the score cannot hide a critical risk).
  const caps: { cap: number; reason: string }[] = [];
  if (inflow > 0 && net < 0) {
    caps.push({ cap: 45, reason: `spending exceeded income by ${formatMoney(-net, cur)} over the period` });
  }
  if (runwayMonths !== undefined && runwayMonths < 1) {
    caps.push({ cap: 55, reason: `cash runway is under one month (${runwayMonths.toFixed(1)})` });
  }
  // A household in deficit in more than half of its months is the condition D8 calls
  // "majority of months cash-flow negative". The threshold is a strict majority of months
  // (positiveShare < 0.5), not the stricter two-thirds the code applied until D21: a
  // profile that is negative in four months out of seven is already the severe weakness
  // the cap exists to surface, and must not read as "strong" on the strength of a healthy
  // runway. See DECISIONS.md D21 for why the documented rule won over the implemented one.
  if (flows.length >= 2 && positiveShare < 0.5) {
    const negativeMonths = flows.length - positiveMonths;
    caps.push({ cap: 55, reason: `most months were cash-flow negative (${negativeMonths}/${flows.length})` });
  }
  const cap = caps.reduce((min, c) => Math.min(min, c.cap), 100);
  const score = Math.min(Math.round(rawScore * 100), cap);

  metrics.unshift(metric("score", "Health score", score, "score"));
  const grade = gradeFor(score);

  findings.push({
    severity: severityForScore(score),
    message: `Overall financial health is ${grade} (${score}/100), assessed across ${assessed.length} dimension(s).`,
    evidence: assessed.map((d) => ({
      label: d.label,
      detail: `sub-score ${(d.score * 100).toFixed(0)}/100`,
      value: d.score,
    })),
  });

  // Surface any cap explicitly so the risk that limited the score is never hidden.
  if (caps.length > 0) {
    const binding = caps.reduce((lo, c) => (c.cap < lo.cap ? c : lo), caps[0]!);
    findings.push({
      severity: binding.cap <= 45 ? "critical" : "warning",
      message: `Score capped at ${binding.cap} because ${binding.reason}.`,
      evidence: caps.map((c) => ({ label: `cap ${c.cap}`, detail: c.reason })),
    });
  }

  const weakest = assessed.reduce((lo, d) => (d.score < lo.score ? d : lo), assessed[0]!);
  findings.push({
    severity: "notice",
    message: `Weakest assessed area is ${weakest.label} — the biggest opportunity to improve.`,
    evidence: [{ label: weakest.label, detail: `sub-score ${(weakest.score * 100).toFixed(0)}/100`, value: weakest.score }],
  });

  if (notAssessed.length > 0) {
    findings.push({
      severity: "info",
      message: `Not assessed (data absent): ${notAssessed.join("; ")}.`,
      evidence: [],
    });
  }

  return {
    module: "health",
    title: "Financial Health",
    metrics,
    findings,
    evidence: [{ label: "composite", detail: `${score}/100 (${grade})`, value: score }],
  };
}

function gradeFor(score: number): string {
  if (score >= 80) return "strong";
  if (score >= 65) return "healthy";
  if (score >= 50) return "fair";
  if (score >= 35) return "fragile";
  return "at risk";
}

function severityForScore(score: number): Severity {
  if (score >= 65) return "info";
  if (score >= 50) return "notice";
  if (score >= 35) return "warning";
  return "critical";
}
