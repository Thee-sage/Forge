import { totalPortfolioValue, type FinancialModel } from "../core/model.js";
import { formatMoney, formatPercent, safeDiv } from "../core/money.js";
import { metric, type AnalysisResult, type Finding } from "../core/result.js";

/**
 * Portfolio concentration risk via the Herfindahl-Hirschman Index (HHI) on position
 * weights. HHI ranges from 1/n (equal weights) to 1 (single position); >0.25 is a common
 * "concentrated" threshold.
 *
 * Cash is excluded from the *market-risk* concentration (`riskHhi`): a large cash position
 * is a liquidity/return-drag question, not a market-concentration risk, so it must not
 * trip a "dangerously concentrated" alarm. The overall `hhi` is still reported.
 */
export function analyzeConcentration(model: FinancialModel): AnalysisResult {
  const cur = model.currency;
  const total = totalPortfolioValue(model.holdings);
  const findings: Finding[] = [];

  if (model.holdings.length === 0 || total === 0) {
    return {
      module: "concentration",
      title: "Portfolio Concentration",
      metrics: [metric("hhi", "Concentration (HHI)", 0, "ratio")],
      findings: [
        { severity: "info", message: "No holdings to assess for concentration.", evidence: [] },
      ],
      evidence: [],
    };
  }

  const positions = model.holdings
    .map((h) => ({
      label: h.symbol || h.name,
      value: h.value,
      weight: safeDiv(h.value, total),
      isCash: h.assetClass === "cash",
    }))
    .sort((a, b) => b.weight - a.weight);

  // Overall HHI (all positions, informational).
  const hhi = positions.reduce((acc, p) => acc + p.weight * p.weight, 0);
  const effectiveN = hhi > 0 ? 1 / hhi : 0;
  const topWeight = positions[0]?.weight ?? 0;
  const top3Weight = positions.slice(0, 3).reduce((a, p) => a + p.weight, 0);

  // Market-risk HHI over non-cash positions only (renormalised among themselves).
  const nonCash = positions.filter((p) => !p.isCash);
  const nonCashTotal = nonCash.reduce((a, p) => a + p.value, 0);
  const riskHhi =
    nonCashTotal > 0
      ? nonCash.reduce((acc, p) => acc + (p.value / nonCashTotal) ** 2, 0)
      : 0;
  // Largest non-cash position as a share of the WHOLE portfolio.
  const topNonCashWeight = nonCash[0]?.weight ?? 0;

  if (nonCash.length === 0) {
    findings.push({
      severity: "info",
      message: "Portfolio is entirely cash — no market-concentration risk, but undiversified for growth.",
      evidence: [{ label: "cash", detail: formatMoney(total, cur), value: 1 }],
    });
  } else {
    if (riskHhi > 0.25) {
      findings.push({
        severity: riskHhi > 0.5 ? "critical" : "warning",
        message: `Investments are concentrated (non-cash HHI ${riskHhi.toFixed(2)}); a shock to the top positions would move most of the portfolio.`,
        evidence: nonCash.slice(0, 3).map((p) => ({
          label: p.label,
          detail: `${formatMoney(p.value, cur)} (${formatPercent(p.weight)})`,
          value: p.weight,
        })),
      });
    }
    if (topNonCashWeight > 0.35) {
      findings.push({
        severity: "warning",
        message: `Single largest investment "${nonCash[0]?.label}" is ${formatPercent(topNonCashWeight)} of the portfolio.`,
        evidence: [
          { label: nonCash[0]?.label ?? "top", detail: formatMoney(nonCash[0]?.value ?? 0, cur), value: topNonCashWeight },
        ],
      });
    }
  }

  return {
    module: "concentration",
    title: "Portfolio Concentration",
    metrics: [
      metric("hhi", "Concentration (HHI, all)", hhi, "ratio"),
      metric("riskHhi", "Market concentration (non-cash HHI)", riskHhi, "ratio"),
      metric("effectivePositions", "Effective positions", effectiveN, "count"),
      metric("topWeight", "Largest position weight", topWeight, "percent"),
      metric("topNonCashWeight", "Largest investment weight", topNonCashWeight, "percent"),
      metric("top3Weight", "Top 3 weight", top3Weight, "percent"),
      metric("positions", "Number of positions", positions.length, "count"),
    ],
    findings,
    evidence: positions.slice(0, 8).map((p) => ({
      label: p.label,
      detail: `${formatMoney(p.value, cur)} (${formatPercent(p.weight)})`,
      value: p.weight,
    })),
  };
}
