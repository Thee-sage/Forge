/**
 * Forge — public library API.
 *
 * Re-exports the building blocks and provides `analyzeFile`, the one-call pipeline:
 * ingest → normalize → analyze → reason.
 */
import { ingest } from "./ingestion/index.js";
import { normalize, type NormalizationReport } from "./normalize/index.js";
import { runAnalyses } from "./analysis/index.js";
import { reason } from "./reasoning/engine.js";
import type { FinancialModel } from "./core/model.js";
import type { AnalysisResult, Insight } from "./core/result.js";

export * from "./core/model.js";
export * from "./core/result.js";
export * from "./core/money.js";
export { ForgeError } from "./core/errors.js";
export {
  CurrencyMismatchError,
  normalizeCurrencyCode,
  distinctCurrencies,
  assertSingleCurrency,
} from "./core/currency.js";
export { ingest, IngestionError } from "./ingestion/index.js";
export { normalize } from "./normalize/index.js";
export type { NormalizationReport, NormalizationOutput, SkippedRow } from "./normalize/index.js";
export {
  runAnalyses,
  ANALYSIS_MODULES,
  assertSingleCurrencyModel,
  dataAvailability,
} from "./analysis/index.js";
export {
  monthlyFlows,
  spendByCategory,
  outflowAmounts,
  periodHalves,
  totals,
  type MonthlyFlow,
  type HalfWindow,
} from "./analysis/aggregates.js";
export { reason, RULES } from "./reasoning/engine.js";
export {
  simulate,
  applyScenario,
  describeScenario,
  validateScenario,
  ScenarioError,
  type ScenarioSpec,
  type ScenarioResult,
  type UnavailableDelta,
} from "./scenario/simulate.js";

export { buildReportView, buildScenarioView } from "./web/viewmodel.js";
export type { ReportView, ScenarioView } from "./web/viewmodel.js";

export interface ForgeReport {
  model: FinancialModel;
  normalization: NormalizationReport;
  analyses: AnalysisResult[];
  insights: Insight[];
}

/** Run the full Forge pipeline on one or more file paths (multi-source ingestion). */
export function analyzeFile(
  paths: string | string[],
  options: { defaultCurrency?: string } = {},
): ForgeReport {
  const list = Array.isArray(paths) ? paths : [paths];
  const tables = list.flatMap((p) => ingest(p));
  const { model, report } = normalize(tables, options);
  const analyses = runAnalyses(model);
  const insights = reason(model, analyses);
  return { model, normalization: report, analyses, insights };
}
