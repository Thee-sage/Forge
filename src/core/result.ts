/**
 * Shared result / insight / evidence types (see ARCHITECTURE.md §5–6).
 *
 * The whole engine trades in these structures: analysis modules emit `AnalysisResult`,
 * the reasoning engine consumes them and emits `Insight`s. Nothing is asserted without
 * `Evidence` backing it (PROJECT_RULES §5).
 */

export type Severity = "info" | "notice" | "warning" | "critical";

/** A named numeric finding. */
export interface Metric {
  key: string;
  label: string;
  value: number;
  /** Optional formatting hint for renderers. */
  unit?: "currency" | "percent" | "ratio" | "count" | "score";
}

/** A piece of data backing a finding or insight, for traceability. */
export interface Evidence {
  label: string;
  detail: string;
  /** Optional numeric magnitude the evidence carries. */
  value?: number;
  /** The analysis module this evidence was drawn from (set by the reasoning layer). */
  module?: string;
}

/** An interpreted observation from a single analysis module. */
export interface Finding {
  severity: Severity;
  message: string;
  evidence: Evidence[];
}

/** The output of one analysis module. */
export interface AnalysisResult {
  module: string;
  title: string;
  metrics: Metric[];
  findings: Finding[];
  evidence: Evidence[];
}

/** A correlated, explained insight produced by the reasoning engine. */
export interface Insight {
  /** The id of the reasoning rule that produced this insight (traceability). */
  ruleId: string;
  headline: string;
  explanation: string;
  drivers: string[];
  severity: Severity;
  evidence: Evidence[];
  /** The analysis modules whose metrics this insight is based on. */
  basis: string[];
  /** 0..1 confidence in the insight. */
  confidence: number;
}

/** What a reasoning rule returns; the engine attaches the `ruleId`. */
export type RuleInsight = Omit<Insight, "ruleId">;

/** Numeric rank for severity, useful for sorting/aggregation. */
export const SEVERITY_RANK: Record<Severity, number> = {
  info: 0,
  notice: 1,
  warning: 2,
  critical: 3,
};

/** Return the higher of two severities. */
export function maxSeverity(a: Severity, b: Severity): Severity {
  return SEVERITY_RANK[a] >= SEVERITY_RANK[b] ? a : b;
}

/** Small helper to build a Metric. */
export function metric(
  key: string,
  label: string,
  value: number,
  unit?: Metric["unit"],
): Metric {
  return { key, label, value, unit };
}

/** Look up a metric value by key across results; returns undefined if absent. */
export function findMetric(
  results: AnalysisResult[],
  moduleName: string,
  key: string,
): number | undefined {
  const mod = results.find((r) => r.module === moduleName);
  return mod?.metrics.find((m) => m.key === key)?.value;
}
