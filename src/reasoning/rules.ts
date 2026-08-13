import type { FinancialModel } from "../core/model.js";
import { formatMoney, formatPercent } from "../core/money.js";
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
  // 1. Declining cash flow explained by a rising spend category.
  {
    id: "cashflow-decline-driver",
    evaluate({ results }) {
      const trendSlope = findMetric(results, "cashflow", "trendSlope") ?? 0;
      if (trendSlope >= -0.15) return null; // not meaningfully declining

      const trend = results.find((r) => r.module === "trend");
      const topRise = trend?.evidence.find((e) => (e.value ?? 0) > 0);
      const drivers: string[] = [];
      let why = "Net cash flow is trending down.";
      if (topRise) {
        drivers.push(`rising ${topRise.label} spend`);
        why = `Net cash flow is trending down, and the largest coincident change is rising "${topRise.label}" spending (${topRise.detail}).`;
      }
      const evidence = [
        ...evidenceFrom(results, "cashflow", 2),
        ...(topRise ? [{ ...topRise, module: "trend" }] : []),
      ];
      return {
        headline: "Cash flow is weakening",
        explanation: why,
        drivers: drivers.length ? drivers : ["higher outflow in the recent period"],
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
    evaluate({ results }) {
      const riskHhi = findMetric(results, "concentration", "riskHhi") ?? 0;
      const topNonCash = findMetric(results, "concentration", "topNonCashWeight") ?? 0;
      if (riskHhi < 0.25 && topNonCash < 0.35) return null;

      const conc = results.find((r) => r.module === "concentration");
      const top = conc?.evidence.find((e) => (e.value ?? 0) > 0);
      return {
        headline: "Portfolio concentration is elevated",
        explanation: `Market concentration (non-cash HHI ${riskHhi.toFixed(2)}) is above the diversified range${top ? `, driven mainly by ${top.label} at ${top.detail}` : ""}. A shock to that position would move most of the portfolio.`,
        drivers: [top ? `oversized ${top.label} position` : "few large investments"],
        severity: riskHhi > 0.5 ? "critical" : "warning",
        evidence: evidenceFrom(results, "concentration", 3),
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
      const largest = findMetric(results, "anomaly", "largest") ?? 0;
      if (count === 0 || largest === 0) return null;
      const outflow = findMetric(results, "expenditure", "totalOutflow") ?? 0;
      const share = outflow > 0 ? largest / outflow : 0;
      if (share < 0.1) return null;
      return {
        headline: "A large one-off charge skews the period",
        explanation: `The single largest outflow (${formatMoney(largest, model.currency)}) is ${formatPercent(share)} of all spending. Period averages and trends are sensitive to it; consider whether it is recurring or exceptional.`,
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
    evaluate({ results }) {
      const score = findMetric(results, "health", "score");
      const savingsRate = findMetric(results, "cashflow", "savingsRate") ?? 0;
      if (score === undefined || score < 70 || savingsRate < 0.2) return null;
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
