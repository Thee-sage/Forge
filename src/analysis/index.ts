import type { FinancialModel } from "../core/model.js";
import type { AnalysisResult } from "../core/result.js";
import { assertSingleCurrencyModel } from "./validate.js";
import { analyzeAllocation } from "./allocation.js";
import { analyzeAnomalies } from "./anomaly.js";
import { analyzeCashflow } from "./cashflow.js";
import { analyzeConcentration } from "./concentration.js";
import { analyzeExpenditure } from "./expenditure.js";
import { analyzeHealth } from "./health.js";
import { analyzeTrends } from "./trend.js";

export { analyzeHealth } from "./health.js";
export { analyzeCashflow } from "./cashflow.js";
export { analyzeExpenditure } from "./expenditure.js";
export { analyzeAllocation } from "./allocation.js";
export { analyzeConcentration } from "./concentration.js";
export { analyzeAnomalies } from "./anomaly.js";
export { analyzeTrends } from "./trend.js";
export { assertSingleCurrencyModel, dataAvailability } from "./validate.js";
export type { DataAvailability } from "./validate.js";
export * from "./aggregates.js";

/** An analysis module: a pure function of the model (PROJECT_RULES §2). */
export type AnalysisModule = (model: FinancialModel) => AnalysisResult;

/** The registry of modules run by `runAnalyses`, in display order. */
export const ANALYSIS_MODULES: AnalysisModule[] = [
  analyzeHealth,
  analyzeCashflow,
  analyzeExpenditure,
  analyzeTrends,
  analyzeAnomalies,
  analyzeAllocation,
  analyzeConcentration,
];

/**
 * Run every registered analysis module against the model.
 * Precondition: the model uses a single currency — throws `CurrencyMismatchError`
 * otherwise, so no downstream module can silently mix currencies (hardening §1).
 */
export function runAnalyses(model: FinancialModel): AnalysisResult[] {
  assertSingleCurrencyModel(model);
  return ANALYSIS_MODULES.map((fn) => fn(model));
}
