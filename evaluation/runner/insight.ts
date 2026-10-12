import { forgeFlaggedIndices, metaOf } from "./numeric.js";
import type { Execution } from "./execute.js";
import { mkCheck, type Check } from "./records.js";

/**
 * Insight correctness against human labels (rubric: docs/ACCURACY_VALIDATION.md section 5).
 *
 * Label keys:
 *   insight:<ruleId>              did the reasoning rule fire?
 *   anomaly:<description>         was this transaction flagged as an anomaly?
 *   trend:<category>              was a "spending rose" finding emitted for the category?
 *   finding:cashflow.negative-months | finding:expenditure.concentrated
 *
 * A label is true ("should be emitted"), false ("must not be emitted"), or absent
 * (ungraded: neither a false positive nor a false negative). Emissions that carry no label
 * are counted separately as `ungraded` so nothing is hidden.
 */
export const FINDING_TYPES = [
  "insight:cashflow-decline-driver",
  "insight:low-savings-driver",
  "insight:portfolio-concentration",
  "insight:thin-liquidity",
  "insight:anomaly-impact",
  "insight:healthy-position",
  "anomaly",
  "trend-rise",
  "finding:cashflow.negative-months",
  "finding:expenditure.concentrated",
] as const;

export function typeOf(labelKey: string): string {
  if (labelKey.startsWith("anomaly:")) return "anomaly";
  if (labelKey.startsWith("trend:")) return "trend-rise";
  return labelKey;
}

function predicted(e: Execution, labelKey: string): boolean {
  const r = e.report!;
  if (labelKey.startsWith("insight:")) return r.insights.some((i) => i.ruleId === labelKey.slice("insight:".length));
  if (labelKey.startsWith("anomaly:")) {
    const desc = labelKey.slice("anomaly:".length);
    return forgeFlaggedIndices(e).some((i) => e.case.truth.txns[i]!.description === desc);
  }
  if (labelKey.startsWith("trend:")) {
    const cat = labelKey.slice("trend:".length);
    return Boolean(r.analyses.find((a) => a.module === "trend")?.findings.some((f) => f.message.includes(`"${cat}"`) && /\brose\b/.test(f.message)));
  }
  if (labelKey === "finding:cashflow.negative-months") return Boolean(r.analyses.find((a) => a.module === "cashflow")?.findings.some((f) => /months had negative cash flow/.test(f.message)));
  if (labelKey === "finding:expenditure.concentrated") return Boolean(r.analyses.find((a) => a.module === "expenditure")?.findings.some((f) => /Spending is concentrated/.test(f.message)));
  throw new Error(`insight.ts: unknown label key ${labelKey}`);
}

export function insightChecks(e: Execution): Check[] {
  const labels = e.case.labels;
  if (!labels || !e.report) return [];
  const meta = metaOf(e);
  const out: Check[] = [];
  for (const [key, expected] of Object.entries(labels)) {
    const got = predicted(e, key);
    const outcome = expected ? (got ? "tp" : "fn") : got ? "fp" : "tn";
    out.push(mkCheck(meta, "insight", typeOf(key), outcome === "tp" || outcome === "tn" ? "pass" : "fail", outcome === "fp" ? "major" : "major", {
      outcome, expected: `${key} = ${expected}`, actual: got,
    }));
  }
  return out;
}

/** Emissions with no label in their case (reported as ungraded, never scored). */
export function ungradedEmissions(e: Execution): string[] {
  if (!e.report) return [];
  const labels = e.case.labels ?? {};
  const out: string[] = [];
  for (const i of e.report.insights) if (!(`insight:${i.ruleId}` in labels)) out.push(`insight:${i.ruleId}`);
  for (const idx of forgeFlaggedIndices(e)) if (!(`anomaly:${e.case.truth.txns[idx]!.description}` in labels)) out.push(`anomaly:${e.case.truth.txns[idx]!.description}`);
  return out;
}
