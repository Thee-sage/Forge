import { describe, it, expect } from "vitest";
import { normalize } from "./index.js";
import { inferDateOrder, toIsoDate } from "./dates.js";
import { rawTable } from "../testkit.js";

describe("header alias robustness", () => {
  const variants = ["Amount", "amount", "Transaction Amount", "Value", "amt"];
  for (const header of variants) {
    it(`recognises "${header}" as the amount column`, () => {
      const t = rawTable([{ Date: "2024-01-01", Description: "pay", [header]: 5000 }], ["Date", "Description", header]);
      const { model } = normalize([t]);
      expect(model.transactions).toHaveLength(1);
      expect(model.transactions[0]!.amount).toBe(5000);
    });
  }

  it("recognises Income/Expense columns like debit/credit", () => {
    const t = rawTable(
      [
        { Date: "2024-01-01", Description: "pay", Income: 5000, Expense: "" },
        { Date: "2024-01-02", Description: "rent", Income: "", Expense: 1500 },
      ],
      ["Date", "Description", "Income", "Expense"],
    );
    const { model } = normalize([t]);
    expect(model.transactions.map((x) => x.direction)).toEqual(["inflow", "outflow"]);
    expect(model.transactions[1]!.amount).toBe(1500);
  });

  it("skips a table with no recognisable amount column and explains every row", () => {
    const t = rawTable(
      [{ Date: "2024-01-01", Notes: "x" }, { Date: "2024-01-02", Notes: "y" }],
      ["Date", "Notes"],
    );
    const { model, report } = normalize([t]);
    expect(model.transactions).toHaveLength(0);
    expect(report.skippedRows).toHaveLength(2);
    expect(report.skippedRows.every((s) => s.reason.includes("amount"))).toBe(true);
  });
});

describe("date order inference", () => {
  it("detects DD/MM from a day > 12", () => {
    expect(inferDateOrder(["13/02/2024", "05/06/2024"]).order).toBe("dmy");
  });
  it("detects MM/DD from a second field > 12", () => {
    expect(inferDateOrder(["02/13/2024", "05/06/2024"]).order).toBe("mdy");
  });
  it("marks a column ambiguous when nothing disambiguates", () => {
    const r = inferDateOrder(["05/06/2024", "07/08/2024"]);
    expect(r.ambiguous).toBe(true);
    expect(r.order).toBe("dmy"); // documented default
  });
  it("flags a conflict when both orders are implied", () => {
    expect(inferDateOrder(["13/02/2024", "02/13/2024"]).conflict).toBe(true);
  });
  it("applies the inferred order to ambiguous values", () => {
    expect(toIsoDate("05/06/2024", "dmy")).toBe("2024-06-05");
    expect(toIsoDate("05/06/2024", "mdy")).toBe("2024-05-06");
  });
});

describe("normalization warns about ambiguous dates rather than guessing silently", () => {
  it("emits a warning when the date column is ambiguous", () => {
    const t = rawTable(
      [
        { Date: "05/06/2024", Description: "a", Amount: -10 },
        { Date: "07/08/2024", Description: "b", Amount: -20 },
      ],
      ["Date", "Description", "Amount"],
    );
    const { report } = normalize([t]);
    expect(report.warnings.some((w) => /ambiguous/i.test(w))).toBe(true);
  });

  it("uses an inferred MM/DD order across the column", () => {
    const t = rawTable(
      [
        { Date: "01/13/2024", Description: "a", Amount: -10 }, // proves MM/DD
        { Date: "02/05/2024", Description: "b", Amount: -20 }, // now read as Feb 5
      ],
      ["Date", "Description", "Amount"],
    );
    const { model } = normalize([t]);
    expect(model.transactions.map((x) => x.date)).toEqual(["2024-01-13", "2024-02-05"]);
  });
});

describe("amount parsing across messy inputs", () => {
  it("parses commas/symbols/parentheses and skips zero/blank/invalid with reasons", () => {
    const rows = [
      { Date: "2024-01-01", Description: "a", Amount: "1,234.50" },
      { Date: "2024-01-01", Description: "b", Amount: "$500" },
      { Date: "2024-01-01", Description: "c", Amount: "(200.00)" },
      { Date: "2024-01-01", Description: "d", Amount: "-30" },
      { Date: "2024-01-01", Description: "e", Amount: "0" },
      { Date: "2024-01-01", Description: "f", Amount: "" },
      { Date: "2024-01-01", Description: "g", Amount: "abc" },
    ];
    const { model, report } = normalize([rawTable(rows, ["Date", "Description", "Amount"])]);
    expect(model.transactions).toHaveLength(4);
    const byDesc = Object.fromEntries(model.transactions.map((t) => [t.description, t]));
    expect(byDesc["a"]!.amount).toBe(1234.5);
    expect(byDesc["b"]!.direction).toBe("inflow");
    expect(byDesc["c"]!.direction).toBe("outflow"); // parenthesised => negative
    expect(byDesc["d"]!.direction).toBe("outflow");
    expect(report.skippedRows).toHaveLength(3); // zero, blank, invalid
    expect(report.skippedRows.every((s) => /amount/.test(s.reason))).toBe(true);
  });

  it("records a per-row reason when the date is invalid", () => {
    const { report } = normalize([
      rawTable(
        [{ Date: "not-a-date", Description: "x", Amount: 100 }],
        ["Date", "Description", "Amount"],
      ),
    ]);
    expect(report.skippedRows).toHaveLength(1);
    expect(report.skippedRows[0]!.reason).toMatch(/date/i);
  });
});
