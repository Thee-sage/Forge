import type { FinancialModel } from "../core/model.js";
import { formatMoney, formatPercent, safeDiv } from "../core/money.js";
import { metric, type AnalysisResult, type Finding } from "../core/result.js";
import { spendByCategory, totals } from "./aggregates.js";

/**
 * Expenditure analysis: where the money goes. Category breakdown, top drivers, and
 * over-concentration in any single category.
 */
export function analyzeExpenditure(model: FinancialModel): AnalysisResult {
  const cur = model.currency;
  const { outflow } = totals(model);
  const byCategory = spendByCategory(model.transactions);
  const findings: Finding[] = [];

  const top = byCategory[0];
  if (top && outflow > 0) {
    const share = safeDiv(top.amount, outflow);
    if (share > 0.4 && top.category !== "housing" && top.category !== "rent") {
      findings.push({
        severity: "warning",
        message: `Spending is concentrated: "${top.category}" is ${formatPercent(share)} of all outflow.`,
        evidence: [
          { label: top.category, detail: formatMoney(top.amount, cur), value: top.amount },
          { label: "total outflow", detail: formatMoney(outflow, cur), value: outflow },
        ],
      });
    }
  }

  // Flag an "uncategorized" mass that hurts explainability.
  const uncat = byCategory.find((c) => c.category === "uncategorized");
  if (uncat && safeDiv(uncat.amount, outflow) > 0.25) {
    findings.push({
      severity: "notice",
      message: `${formatPercent(safeDiv(uncat.amount, outflow))} of spending is uncategorized; adding a category column would sharpen insights.`,
      evidence: [{ label: "uncategorized", detail: formatMoney(uncat.amount, cur), value: uncat.amount }],
    });
  }

  const metrics = [
    metric("totalOutflow", "Total outflow", outflow, "currency"),
    metric("categories", "Distinct categories", byCategory.length, "count"),
  ];
  // Add the top 5 categories as metrics for downstream reasoning.
  byCategory.slice(0, 5).forEach((c, i) => {
    metrics.push(
      metric(`top${i + 1}_amount`, `#${i + 1} ${c.category}`, c.amount, "currency"),
      metric(`top${i + 1}_share`, `#${i + 1} ${c.category} share`, safeDiv(c.amount, outflow), "percent"),
    );
  });

  return {
    module: "expenditure",
    title: "Expenditure",
    metrics,
    findings,
    evidence: byCategory.slice(0, 10).map((c) => ({
      label: c.category,
      detail: `${formatMoney(c.amount, cur)} (${formatPercent(safeDiv(c.amount, outflow))})`,
      value: c.amount,
    })),
  };
}
