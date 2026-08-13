import type { FinancialModel } from "../core/model.js";
import { SEVERITY_RANK, type AnalysisResult, type Insight } from "../core/result.js";
import { RULES, type ReasoningRule } from "./rules.js";

/**
 * The reasoning engine. It runs every declarative rule over the analysis results and
 * returns the emitted insights, most severe (and most confident) first. It holds no
 * domain logic itself — all reasoning lives in `rules.ts` so the engine never changes
 * when reasoning grows (ARCHITECTURE.md §6).
 */
export function reason(
  model: FinancialModel,
  results: AnalysisResult[],
  rules: ReasoningRule[] = RULES,
): Insight[] {
  const ctx = { model, results };
  const insights: Insight[] = [];
  for (const rule of rules) {
    try {
      const output = rule.evaluate(ctx);
      // Enforce "no insight without evidence" (PROJECT_RULES §5) as a hard invariant:
      // an insight with no supporting evidence is dropped rather than shown.
      if (output && output.evidence.length > 0) {
        insights.push({ ...output, ruleId: rule.id });
      }
    } catch {
      // A faulty rule must never take down the engine; skip it silently.
      continue;
    }
  }
  return insights.sort((a, b) => {
    const sev = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
    return sev !== 0 ? sev : b.confidence - a.confidence;
  });
}

export { RULES } from "./rules.js";
export type { ReasoningRule, ReasoningContext } from "./rules.js";
