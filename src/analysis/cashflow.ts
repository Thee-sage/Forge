import type { FinancialModel } from "../core/model.js";
import { formatMoney, formatPercent, safeDiv } from "../core/money.js";
import { metric, type AnalysisResult, type Finding } from "../core/result.js";
import { monthlyFlows, totals } from "./aggregates.js";

/**
 * Cash-flow analysis: inflow/outflow over time, savings rate, and trend direction.
 * Pure function of the model (PROJECT_RULES §2).
 */
export function analyzeCashflow(model: FinancialModel): AnalysisResult {
  const cur = model.currency;
  const { inflow, outflow, net } = totals(model);
  const flows = monthlyFlows(model.transactions);
  const savingsRate = safeDiv(net, inflow);
  const avgMonthlyNet = safeDiv(net, model.period.months);

  const findings: Finding[] = [];

  // Negative-net months.
  const negativeMonths = flows.filter((f) => f.net < 0);
  if (negativeMonths.length > 0) {
    findings.push({
      severity: negativeMonths.length >= flows.length / 2 ? "warning" : "notice",
      message: `${negativeMonths.length} of ${flows.length} months had negative cash flow (spending exceeded income).`,
      evidence: negativeMonths.slice(0, 4).map((m) => ({
        label: m.month,
        detail: `net ${formatMoney(m.net, cur)}`,
        value: m.net,
      })),
    });
  }

  // Overall savings rate assessment.
  if (inflow > 0) {
    if (savingsRate < 0) {
      findings.push({
        severity: "critical",
        message: `Overall spending exceeded income by ${formatMoney(-net, cur)} across the period.`,
        evidence: [
          { label: "inflow", detail: formatMoney(inflow, cur), value: inflow },
          { label: "outflow", detail: formatMoney(outflow, cur), value: outflow },
        ],
      });
    } else if (savingsRate < 0.1) {
      findings.push({
        severity: "warning",
        message: `Savings rate is low at ${formatPercent(savingsRate)} of income.`,
        evidence: [{ label: "net saved", detail: formatMoney(net, cur), value: net }],
      });
    }
  }

  // Trend: compare first vs second half of the series.
  const trend = trendDirection(flows.map((f) => f.net));
  if (flows.length >= 4 && trend.slope < 0 && trend.magnitude > 0.15) {
    findings.push({
      severity: "warning",
      message: `Monthly net cash flow is trending down (${formatPercent(trend.magnitude)} lower in the recent half).`,
      evidence: [
        { label: "earlier avg net", detail: formatMoney(trend.firstAvg, cur), value: trend.firstAvg },
        { label: "recent avg net", detail: formatMoney(trend.secondAvg, cur), value: trend.secondAvg },
      ],
    });
  }

  return {
    module: "cashflow",
    title: "Cash Flow",
    metrics: [
      metric("inflow", "Total inflow", inflow, "currency"),
      metric("outflow", "Total outflow", outflow, "currency"),
      metric("net", "Net cash flow", net, "currency"),
      metric("savingsRate", "Savings rate", savingsRate, "percent"),
      metric("avgMonthlyNet", "Avg monthly net", avgMonthlyNet, "currency"),
      metric("months", "Months covered", model.period.months, "count"),
      metric("trendSlope", "Net trend (recent vs earlier)", trend.magnitude * Math.sign(trend.slope), "ratio"),
    ],
    findings,
    evidence: flows.map((f) => ({
      label: f.month,
      detail: `in ${formatMoney(f.inflow, cur)}, out ${formatMoney(f.outflow, cur)}, net ${formatMoney(f.net, cur)}`,
      value: f.net,
    })),
  };
}

/** Compare the average of the first half of a series to the second half. */
export function trendDirection(series: number[]): {
  slope: number;
  magnitude: number;
  firstAvg: number;
  secondAvg: number;
} {
  if (series.length < 2) return { slope: 0, magnitude: 0, firstAvg: 0, secondAvg: 0 };
  const mid = Math.floor(series.length / 2);
  const first = series.slice(0, mid);
  const second = series.slice(mid);
  const firstAvg = first.reduce((a, b) => a + b, 0) / (first.length || 1);
  const secondAvg = second.reduce((a, b) => a + b, 0) / (second.length || 1);
  const slope = secondAvg - firstAvg;
  const base = Math.abs(firstAvg) || 1;
  return { slope, magnitude: Math.abs(slope) / base, firstAvg, secondAvg };
}
