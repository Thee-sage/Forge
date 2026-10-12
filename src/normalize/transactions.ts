import type { Direction, Transaction } from "../core/model.js";
import { parseAmount } from "../core/money.js";
import { currencyInAmountText, normalizeCurrencyCode } from "../core/currency.js";
import type { RawTable } from "../ingestion/types.js";
import { categorize } from "./categorize.js";
import { cellString, resolveColumns, TRANSACTION_ALIASES } from "./columns.js";
import { inferDateOrder, toIsoDate } from "./dates.js";
import type { SkippedRow } from "./skipped.js";

export interface NormalizeTxnResult {
  transactions: Transaction[];
  warnings: string[];
  skipped: number;
  skippedDetails: SkippedRow[];
}

/**
 * Normalize a transactions RawTable into unified `Transaction`s.
 *
 * Amount handling:
 *  - If explicit debit/credit (or income/expense) columns exist, they set the direction.
 *  - Else a single amount column's sign sets the direction (negative => outflow).
 * Amount is always stored positive; `direction` carries the sign (PROJECT_RULES §4).
 * Every dropped row is recorded in `skippedDetails` with a reason — no silent loss.
 */
export function normalizeTransactions(
  table: RawTable,
  defaultCurrency: string,
): NormalizeTxnResult {
  const cols = resolveColumns(table.headers, TRANSACTION_ALIASES);
  const warnings: string[] = [];
  const transactions: Transaction[] = [];
  const skippedDetails: SkippedRow[] = [];

  if (!cols.date) {
    warnings.push(
      `Table "${table.name}": no date column found; transactions cannot be dated and will be skipped.`,
    );
  }
  const hasAmount = Boolean(cols.amount);
  const hasDebitCredit = Boolean(cols.debit || cols.credit);
  if (!hasAmount && !hasDebitCredit) {
    warnings.push(
      `Table "${table.name}": no amount/debit/credit column found; skipping table.`,
    );
    const details = table.rows.map((_, i) => ({
      table: table.name,
      source: table.source,
      row: i,
      reason: "no amount/debit/credit column in table",
    }));
    return { transactions, warnings, skipped: details.length, skippedDetails: details };
  }

  // Infer the date field order once for the whole column, then report the assumption.
  const dateValues = cols.date ? table.rows.map((r) => r[cols.date as string]) : [];
  const dateOrder = inferDateOrder(dateValues);
  const unrecognisedCurrencies = new Set<string>();
  if (cols.date && dateOrder.conflict) {
    warnings.push(
      `Table "${table.name}": date column mixes DD/MM and MM/DD styles; assuming DD/MM. Verify affected dates.`,
    );
  } else if (cols.date && dateOrder.ambiguous && dateValues.some((v) => typeof v === "string" && v.includes("/"))) {
    warnings.push(
      `Table "${table.name}": numeric dates are ambiguous (no day > 12 to disambiguate); assuming DD/MM.`,
    );
  }

  table.rows.forEach((row, i) => {
    const record = (reason: string) =>
      skippedDetails.push({ table: table.name, source: table.source, row: i, reason });

    const date = toIsoDate(row[cols.date ?? ""], dateOrder.order);
    const description = cellString(row, cols.description) || "(no description)";

    let amount: number | undefined;
    let direction: Direction | undefined;

    if (hasDebitCredit) {
      const debit = parseAmount(row[cols.debit ?? ""]);
      const credit = parseAmount(row[cols.credit ?? ""]);
      if (credit && debit && credit !== 0 && debit !== 0) {
        // Both columns populated: which one is true? Keeping one and dropping the other would
        // silently lose money, so the row is skipped and the reason recorded.
        record("both debit and credit populated (contradictory)");
        return;
      }
      if (credit && credit !== 0) {
        amount = Math.abs(credit);
        direction = "inflow";
      } else if (debit && debit !== 0) {
        amount = Math.abs(debit);
        direction = "outflow";
      }
    } else {
      const parsed = parseAmount(row[cols.amount ?? ""]);
      if (parsed !== undefined && parsed !== 0) {
        amount = Math.abs(parsed);
        direction = parsed < 0 ? "outflow" : "inflow";
      }
    }

    if (amount === undefined || direction === undefined) {
      record("missing, zero, or invalid amount");
      return;
    }
    if (!date) {
      record("missing or invalid date");
      return;
    }

    // Category: explicit column, else keyword inference.
    const explicitCategory = cellString(row, cols.category);
    const category = explicitCategory
      ? explicitCategory.toLowerCase()
      : categorize(description).category;

    // Currency: an explicit column wins; else the currency the amount cell carries on its face
    // ("€20.00"); else the declared default. An unrecognised currency cell is never silently
    // treated as the default: it is reported below.
    const currencyCell = cellString(row, cols.currency);
    const cellCode = normalizeCurrencyCode(currencyCell);
    if (currencyCell !== "" && cellCode === undefined) unrecognisedCurrencies.add(currencyCell);
    const faceCurrency = hasDebitCredit
      ? currencyInAmountText(row[direction === "inflow" ? (cols.credit ?? "") : (cols.debit ?? "")])
      : currencyInAmountText(row[cols.amount ?? ""]);
    const currency = cellCode ?? faceCurrency ?? defaultCurrency;
    const account = cellString(row, cols.account) || undefined;

    transactions.push({
      id: `${table.name}#${i}`,
      date,
      amount,
      currency,
      direction,
      category,
      description,
      account,
      source: table.source,
      raw: row,
    });
  });

  if (unrecognisedCurrencies.size > 0) {
    warnings.push(
      `Table "${table.name}": unrecognised currency value(s) ${[...unrecognisedCurrencies].slice(0, 3).map((c) => `"${c}"`).join(", ")}; those rows are assumed to be ${defaultCurrency}. Verify the currency before relying on totals.`,
    );
  }

  if (skippedDetails.length > 0) {
    warnings.push(
      `Table "${table.name}": skipped ${skippedDetails.length} row(s) with missing/invalid date or amount.`,
    );
  }

  return {
    transactions,
    warnings,
    skipped: skippedDetails.length,
    skippedDetails,
  };
}
