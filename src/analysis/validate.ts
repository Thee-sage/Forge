import type { FinancialModel } from "../core/model.js";
import { CurrencyMismatchError, distinctCurrencies } from "../core/currency.js";

/**
 * Pre-flight validation for the analysis pipeline. Forge's integrity guarantee is that
 * monetary values from different currencies are never silently combined; since the health
 * score, cash-flow totals and portfolio metrics all assume one currency, a model that
 * mixes currencies cannot be analysed and fails clearly here (hardening §1).
 */
export function assertSingleCurrencyModel(model: FinancialModel): void {
  const monetary = [...model.transactions, ...model.holdings];
  const currencies = distinctCurrencies(monetary);
  if (currencies.length > 1) {
    throw new CurrencyMismatchError(currencies, "analyse this dataset");
  }
}

/** Which parts of the model carry enough data to be assessed (drives health scoring). */
export interface DataAvailability {
  hasTransactions: boolean;
  hasHoldings: boolean;
  hasIncome: boolean; // at least one inflow
  hasExpenses: boolean; // at least one outflow
  monthsCovered: number;
}

export function dataAvailability(model: FinancialModel): DataAvailability {
  const hasIncome = model.transactions.some((t) => t.direction === "inflow");
  const hasExpenses = model.transactions.some((t) => t.direction === "outflow");
  const months = new Set(model.transactions.map((t) => t.date.slice(0, 7)));
  return {
    hasTransactions: model.transactions.length > 0,
    hasHoldings: model.holdings.length > 0,
    hasIncome,
    hasExpenses,
    monthsCovered: months.size,
  };
}
