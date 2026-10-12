import type { FinancialModel } from "../core/model.js";
import { formatMoney, formatPercent } from "../core/money.js";
import { monthlyFlows, periodHalves } from "../analysis/aggregates.js";
import { dataAvailability } from "../analysis/validate.js";
import {
  findMetric,
  type AnalysisResult,
  type Evidence,
  type RuleInsight,
} from "../core/result.js";

/**
 * Declarative reasoning rules. Each rule inspects the analysis results (and, when useful,
 * the model) and optionally emits an insight that *explains why* an outcome occurred by
 * correlating multiple data points. Adding reasoning means adding a rule here — the engine
 * itself does not change (open/closed, PROJECT_RULES §2).
 *
 * Traceability (hardening §3): every emitted insight carries the modules it is `basis`d on
 * and evidence tagged with its source module; the engine attaches the firing `ruleId`.
 * No rule may fire on absent/zero data — each guards on the metrics it needs.
 */

export interface ReasoningContext {
  model: FinancialModel;
  results: AnalysisResult[];
}

export interface ReasoningRule {
  id: string;
  /** Return an insight to emit, or null to stay silent. */
  evaluate(ctx: ReasoningContext): RuleInsight | null;
}

/** Pull the top evidence entries from a named module's result, tagged with that module. */
function evidenceFrom(results: AnalysisResult[], moduleName: string, n = 3): Evidence[] {
  const mod = results.find((r) => r.module === moduleName);
  return (mod?.evidence ?? []).slice(0, n).map((e) => ({ ...e, module: moduleName }));
}

export const RULES: ReasoningRule[] = [
  // 1. Declining cash flow, attributed only to a cause the data shows.
  {
    id: "cashflow-decline-driver",
    evaluate({ results, model }) {
      const trendSlope = findMetric(results, "cashflow", "trendSlope") ?? 0;
      if (trendSlope >= -0.15) return null; // not meaningfully declining
      // A "trend" needs at least four months of history (the cash-flow module's own rule).
      if (dataAvailability(model).monthsCovered < 4) return null;

      // What actually moved? Compare per-month income and spending between the two halves, so a
      // decline caused by lower INCOME is never described as rising SPENDING (or vice versa).
      const halves = periodHalves(monthlyFlows(model.transactions));
      const perMonth = (w: { months: string[]; inflow: number; outflow: number }) => ({
        inflow: w.inflow / w.months.length,
        outflow: w.outflow / w.months.length,
      });
      const early = halves ? perMonth(halves.earlier) : undefined;
      const recent = halves ? perMonth(halves.recent) : undefined;
      const spendingUp = early !== undefined && recent !== undefined && recent.outflow > early.outflow + 1e-9;
      const incomeDown = early !== undefined && recent !== undefined && recent.inflow < early.inflow - 1e-9;

      const trend = results.find((r) => r.module === "trend");
      const topRise = spendingUp ? trend?.evidence.find((e) => (e.value ?? 0) > 0) : undefined;
      const drivers: string[] = [];
      const parts: string[] = ["Net cash flow is trending down."];
      if (spendingUp) {
        if (topRise) {
          drivers.push(`rising ${topRise.label} spend`);
          parts.push(`Average monthly spending rose, and the largest rising category is "${topRise.label}" (${topRise.detail}).`);
        } else {
          drivers.push("higher outflow in the recent period");
          parts.push("Average monthly spending was higher in the recent period.");
        }
      }
      if (incomeDown) {
        drivers.push("lower income in the recent period");
        parts.push("Average monthly income was lower in the recent period.");
      }
      if (drivers.length === 0) drivers.push("net cash flow fell without a single identified driver");

      // Evidence for the claim itself: the earlier-vs-recent comparison the cash-flow module published.
      const cashflow = results.find((r) => r.module === "cashflow");
      const trendFinding = cashflow?.findings.find((f) => /trending down/.test(f.message));
      const decline = (trendFinding?.evidence ?? []).map((e) => ({ ...e, module: "cashflow" }));
      const evidence = [
        ...(decline.length > 0 ? decline : evidenceFrom(results, "cashflow", 2)),
        ...(topRise ? [{ ...topRise, module: "trend" }] : []),
      ];
      return {
        headline: "Cash flow is weakening",
        explanation: parts.join(" "),
        drivers,
        severity: "warning",
        evidence,
        basis: ["cashflow", "trend"],
        confidence: topRise ? 0.75 : 0.55,
      };
    },
  },

  // 2. Low savings rate explained by the dominant expense category.
  {
    id: "low-savings-driver",
    evaluate({ results }) {
      const inflow = findMetric(results, "cashflow", "inflow") ?? 0;
      const outflow = findMetric(results, "expenditure", "totalOutflow") ?? 0;
      // Needs real cash-flow data: skip for holdings-only or empty inputs.
      if (inflow <= 0 || outflow <= 0) return null;
      const savingsRate = findMetric(results, "cashflow", "savingsRate");
      if (savingsRate === undefined || savingsRate >= 0.1) return null;

      const exp = results.find((r) => r.module === "expenditure");
      const topShare = findMetric(results, "expenditure", "top1_share") ?? 0;
      const topLabel = exp?.metrics.find((m) => m.key === "top1_amount")?.label ?? "top category";
      const cleanLabel = topLabel.replace(/^#1\s*/, "");
      return {
        headline: savingsRate < 0 ? "Spending exceeds income" : "Savings rate is low",
        explanation: `Savings rate is ${formatPercent(savingsRate)}. The single biggest outflow is "${cleanLabel}" at ${formatPercent(topShare)} of spending, the most impactful lever to change.`,
        drivers: [`high "${cleanLabel}" share`, "narrow gap between income and outflow"],
        severity: savingsRate < 0 ? "critical" : "warning",
        evidence: evidenceFrom(results, "expenditure", 3),
        basis: ["cashflow", "expenditure"],
        confidence: 0.7,
      };
    },
  },

  // 3. Concentration risk — based on non-cash (market-risk) concentration.
  {
    id: "portfolio-concentration",
    evaluate({ results, model }) {
      const riskHhi = findMetric(results, "concentration", "riskHhi") ?? 0;
      const topNonCash = findMetric(results, "concentration", "topNonCashWeight") ?? 0;
      if (riskHhi < 0.25 && topNonCash < 0.35) return null;

      // Cash is excluded from market concentration (D10), so it can never be the "driver":
      // the evidence list is ordered by weight and may lead with a cash position.
      const cashLabels = new Set(model.holdings.filter((h) => h.assetClass === "cash").map((h) => h.symbol || h.name));
      const conc = results.find((r) => r.module === "concentration");
      const investments = (conc?.evidence ?? []).filter((e) => !cashLabels.has(e.label));
      const top = investments.find((e) => (e.value ?? 0) > 0);
      return {
        headline: "Portfolio concentration is elevated",
        explanation: `Market concentration (non-cash HHI ${riskHhi.toFixed(2)}) is above the diversified range${top ? `, driven mainly by ${top.label} at ${top.detail}` : ""}. A shock to that position would move most of the portfolio.`,
        drivers: [top ? `oversized ${top.label} position` : "few large investments"],
        severity: riskHhi > 0.5 ? "critical" : "warning",
        evidence: investments.slice(0, 3).map((e) => ({ ...e, module: "concentration" })),
        basis: ["concentration"],
        confidence: 0.8,
      };
    },
  },

  // 4. Thin liquidity buffer (runway) — correlate health runway + allocation cash.
  {
    id: "thin-liquidity",
    evaluate({ results }) {
      const runway = findMetric(results, "health", "runwayMonths");
      const cashWeight = findMetric(results, "allocation", "cashWeight");
      if (runway === undefined || runway >= 3 || cashWeight === undefined) return null;
      return {
        headline: "Liquidity buffer looks thin",
        explanation: `Cash holdings cover only about ${runway.toFixed(1)} month(s) of typical spending (cash is ${formatPercent(cashWeight)} of the portfolio). An unexpected expense would likely force selling investments.`,
        drivers: ["low cash allocation", "limited emergency runway"],
        severity: runway < 1 ? "warning" : "notice",
        evidence: evidenceFrom(results, "allocation", 3),
        basis: ["health", "allocation"],
        confidence: 0.65,
      };
    },
  },

  // 5. Large one-off anomaly distorting the period.
  {
    id: "anomaly-impact",
    evaluate({ results, model }) {
      const count = findMetric(results, "anomaly", "anomalies") ?? 0;
      // The charge in question is the largest FLAGGED outlier. The largest outflow overall is often
      // a recurring commitment such as rent, which is by definition not a one-off.
      const flagged = (results.find((r) => r.module === "anomaly")?.evidence ?? []).map((e) => e.value ?? 0);
      const largest = flagged.length > 0 ? Math.max(...flagged) : 0;
      if (count === 0 || largest === 0) return null;
      const outflow = findMetric(results, "expenditure", "totalOutflow") ?? 0;
      const share = outflow > 0 ? largest / outflow : 0;
      if (share < 0.1) return null;
      return {
        headline: "A large one-off charge skews the period",
        explanation: `The largest flagged outlier (${formatMoney(largest, model.currency)}) is ${formatPercent(share)} of all spending. Period averages and trends are sensitive to it; consider whether it is recurring or exceptional.`,
        drivers: ["outsized individual transaction"],
        severity: share > 0.25 ? "warning" : "notice",
        evidence: evidenceFrom(results, "anomaly", 2),
        basis: ["anomaly", "expenditure"],
        confidence: 0.7,
      };
    },
  },

  // 6. Positive reinforcement — strong health.
  {
    id: "healthy-position",
    evaluate({ results, model }) {
      const score = findMetric(results, "health", "score");
      const savingsRate = findMetric(results, "cashflow", "savingsRate") ?? 0;
      if (score === undefined || score < 70 || savingsRate < 0.2) return null;
      // One or two good months are not a "strong footing": require at least three months of data.
      if (dataAvailability(model).monthsCovered < 3) return null;
      return {
        headline: "Finances are on a strong footing",
        explanation: `Health score is ${score}/100 with a ${formatPercent(savingsRate)} savings rate — income comfortably exceeds spending and reserves are being built.`,
        drivers: ["healthy savings rate", "positive cash flow"],
        severity: "info",
        evidence: evidenceFrom(results, "health", 2),
        basis: ["health", "cashflow"],
        confidence: 0.75,
      };
    },
  },
];
