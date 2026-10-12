/**
 * Metric catalogue: for every metric the evaluator compares, its unit, tolerance and the
 * severity assigned to a mismatch. Tolerances are justified, not tuned:
 *
 *  - currency : abs 1e-6 + rel 1e-13 x |expected|. Forge sums doubles; naive summation of
 *               n terms has worst-case error (n-1)*u*sum|x|, u = 1.1e-16. With n <= 1000 and
 *               sum|x| <= 1e7 that is <= 1.1e-6, so abs 1e-6 plus a 1e-13 relative term
 *               covers float noise yet is four orders of magnitude below one cent (0.01):
 *               any wrong cent fails.
 *  - ratio    : abs 1e-10 + rel 1e-10. Quotients / sums of squares of already-close sums; the
 *               error is a few ulps (~1e-15). 1e-10 leaves headroom without hiding a wrong
 *               fourth decimal.
 *  - count    : exact.
 *  - score    : exact integer (a +-1 score difference is graded "minor", never tolerated).
 *  - display  : numbers quoted in prose are compared at half a unit of the displayed precision.
 */
export type Unit = "currency" | "ratio" | "count" | "score";
export type Severity = "critical" | "major" | "minor";

export interface MetricSpec {
  unit: Unit;
  /** Severity when the metric is wrong. Core totals corrupt everything downstream => critical. */
  severity: Severity;
}

const core: MetricSpec = { unit: "currency", severity: "critical" };
const major = (unit: Unit): MetricSpec => ({ unit, severity: "major" });

export const METRICS: Record<string, MetricSpec> = {
  "cashflow.inflow": core,
  "cashflow.outflow": core,
  "cashflow.net": core,
  "cashflow.savingsRate": major("ratio"),
  "cashflow.avgMonthlyNet": major("currency"),
  "cashflow.months": major("count"),
  "cashflow.trendSlope": major("ratio"),
  "expenditure.totalOutflow": core,
  "expenditure.categories": major("count"),
  "trend.categoriesChanged": major("count"),
  "trend.biggestRise": major("currency"),
  "trend.biggestDrop": major("currency"),
  "anomaly.medianOutflow": major("currency"),
  "anomaly.largest": major("currency"),
  "health.score": major("score"),
  "health.savingsScore": major("ratio"),
  "health.expenseScore": major("ratio"),
  "health.stabilityScore": major("ratio"),
  "health.liquidityScore": major("ratio"),
  "health.diversificationScore": major("ratio"),
  "health.runwayMonths": major("ratio"),
  "health.assessedDimensions": major("count"),
  "allocation.portfolioValue": core,
  "allocation.assetClasses": major("count"),
  "allocation.cashWeight": major("ratio"),
  "concentration.hhi": major("ratio"),
  "concentration.riskHhi": major("ratio"),
  "concentration.effectivePositions": major("ratio"),
  "concentration.topWeight": major("ratio"),
  "concentration.topNonCashWeight": major("ratio"),
  "concentration.top3Weight": major("ratio"),
  "concentration.positions": major("count"),
};

/** Dynamic keys: expenditure.topK_amount/_share, allocation.weight_<class>; scenario keys are prefixed `scenarioN.`. */
export function specFor(key: string): MetricSpec {
  const base = key.replace(/^scenario\d+\./, "").replace(/^delta\./, "");
  const hit = METRICS[base];
  if (hit) return hit;
  if (/^expenditure\.top\d_amount$/.test(base)) return major("currency");
  if (/^expenditure\.top\d_share$/.test(base)) return major("ratio");
  if (/^allocation\.weight_/.test(base)) return major("ratio");
  throw new Error(`metrics.ts: no spec for ${key}`);
}

export function tolerance(unit: Unit, expected: number): number {
  switch (unit) {
    case "currency": return 1e-6 + 1e-13 * Math.abs(expected);
    case "ratio": return 1e-10 + 1e-10 * Math.abs(expected);
    case "count":
    case "score": return 0;
  }
}
