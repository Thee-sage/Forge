import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { analyzeFile } from "./index.js";
import { findMetric } from "./core/result.js";

/**
 * End-to-end coverage for the `.xlsx` reader, which ACCURACY_VALIDATION §10 listed as untested
 * with real workbooks: every other test and every evaluation case reaches the pipeline through
 * CSV text. `samples/household_workbook.xlsx` is a real multi-sheet workbook written by SheetJS,
 * so this exercises the things only a spreadsheet produces — Excel date serials rather than date
 * strings, numeric cells rather than parsed text, a blank row, and shape detection choosing
 * between two sheets.
 */

const workbook = resolve(dirname(fileURLToPath(import.meta.url)), "..", "samples", "household_workbook.xlsx");

describe("analyzing a real .xlsx workbook end to end", () => {
  const report = analyzeFile([workbook]);

  it("reads both sheets, detecting transactions and holdings", () => {
    expect(report.model.transactions).toHaveLength(15);
    expect(report.model.holdings).toHaveLength(4);
    expect(report.normalization.tablesProcessed).toBe(2);
    // The workbook contains a blank row; a reader that turned it into a row would skip it with
    // a reason, and one that mis-detected the sheets would parse the wrong count above.
    expect(report.normalization.rowsSkipped).toBe(0);
  });

  it("reads Excel date serials as the dates they represent, not shifted by a day", () => {
    expect(report.model.period.start).toBe("2024-01-01");
    expect(report.model.period.end).toBe("2024-03-26");
    expect(report.model.period.months).toBe(3);
  });

  it("reads numeric cells exactly, including fractional amounts", () => {
    const groceries = report.model.transactions.filter((t) => t.category === "groceries");
    expect(groceries.map((t) => t.amount)).toEqual([412.55, 428.1, 441.9]);
  });

  it("maps asset classes from the workbook's own wording", () => {
    const classes = Object.fromEntries(report.model.holdings.map((h) => [h.symbol, h.assetClass]));
    expect(classes).toEqual({
      VWRL: "equity",        // "Equity ETF" — the wrapper must not shadow the class (AV-09)
      AGGU: "fixed_income",  // "Bond ETF"
      GLDM: "commodity",     // "Gold ETF"
      CASH: "cash",          // "Checking Account" — a deposit account is cash (D23)
    });
  });

  it("flags the one genuine one-off and not the recurring grocery shop (D22)", () => {
    const anomaly = report.analyses.find((r) => r.module === "anomaly")!;
    expect(findMetric([anomaly], "anomaly", "anomalies")).toBe(1);
    expect(anomaly.evidence.map((e) => e.label).join(" ")).toMatch(/Boiler repair/);
    expect(anomaly.evidence.map((e) => e.label).join(" ")).not.toMatch(/Waitrose/);
  });

  it("produces a single-currency model and traceable insights", () => {
    expect(report.model.currency).toBe("USD");
    for (const insight of report.insights) {
      expect(insight.ruleId).toBeTruthy();
      expect(insight.evidence.length).toBeGreaterThan(0);
    }
  });
});
