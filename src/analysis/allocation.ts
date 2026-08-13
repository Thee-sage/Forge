import {
  totalPortfolioValue,
  type AssetClass,
  type FinancialModel,
} from "../core/model.js";
import { formatMoney, formatPercent, safeDiv } from "../core/money.js";
import { metric, type AnalysisResult, type Finding } from "../core/result.js";

/**
 * Asset allocation: how the portfolio is split across asset classes, and whether it
 * looks under-diversified (e.g. everything in one class, or no cash buffer).
 */
export function analyzeAllocation(model: FinancialModel): AnalysisResult {
  const cur = model.currency;
  const total = totalPortfolioValue(model.holdings);
  const findings: Finding[] = [];

  if (model.holdings.length === 0) {
    return {
      module: "allocation",
      title: "Asset Allocation",
      metrics: [metric("portfolioValue", "Portfolio value", 0, "currency")],
      findings: [
        {
          severity: "info",
          message: "No portfolio holdings were provided; allocation analysis skipped.",
          evidence: [],
        },
      ],
      evidence: [],
    };
  }

  const byClass = new Map<AssetClass, number>();
  for (const h of model.holdings) {
    byClass.set(h.assetClass, (byClass.get(h.assetClass) ?? 0) + h.value);
  }
  const weights = [...byClass.entries()]
    .map(([assetClass, value]) => ({ assetClass, value, weight: safeDiv(value, total) }))
    .sort((a, b) => b.value - a.value);

  const dominant = weights[0];
  if (dominant && dominant.weight > 0.7) {
    if (dominant.assetClass === "cash") {
      // A large cash allocation is low market risk, not a diversification hazard.
      findings.push({
        severity: "notice",
        message: `Portfolio is mostly cash (${formatPercent(dominant.weight)}); low market risk, but likely a drag on long-term returns.`,
        evidence: [{ label: "cash", detail: formatMoney(dominant.value, cur), value: dominant.value }],
      });
    } else {
      findings.push({
        severity: "warning",
        message: `Portfolio is heavily weighted to ${dominant.assetClass} (${formatPercent(dominant.weight)}); limited diversification.`,
        evidence: [{ label: dominant.assetClass, detail: formatMoney(dominant.value, cur), value: dominant.value }],
      });
    }
  }

  const cashWeight = safeDiv(byClass.get("cash") ?? 0, total);
  if (cashWeight < 0.02) {
    findings.push({
      severity: "notice",
      message: `Little to no cash allocation (${formatPercent(cashWeight)}); a liquidity buffer may be thin.`,
      evidence: [{ label: "cash", detail: formatMoney(byClass.get("cash") ?? 0, cur), value: byClass.get("cash") ?? 0 }],
    });
  }

  const metrics = [
    metric("portfolioValue", "Portfolio value", total, "currency"),
    metric("assetClasses", "Asset classes", weights.length, "count"),
    metric("cashWeight", "Cash weight", cashWeight, "percent"),
  ];
  weights.forEach((w) => {
    metrics.push(metric(`weight_${w.assetClass}`, `${w.assetClass} weight`, w.weight, "percent"));
  });

  return {
    module: "allocation",
    title: "Asset Allocation",
    metrics,
    findings,
    evidence: weights.map((w) => ({
      label: w.assetClass,
      detail: `${formatMoney(w.value, cur)} (${formatPercent(w.weight)})`,
      value: w.value,
    })),
  };
}
