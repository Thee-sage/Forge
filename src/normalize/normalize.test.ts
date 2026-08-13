import { describe, it, expect } from "vitest";
import { normalize } from "./index.js";
import type { RawTable } from "../ingestion/types.js";

function table(rows: Record<string, unknown>[], headers: string[], shape: RawTable["shape"] = "transactions"): RawTable {
  return { name: "test", source: "test.csv", headers, rows, shape };
}

describe("normalize transactions", () => {
  it("maps a signed amount column into direction + positive amount", () => {
    const t = table(
      [
        { Date: "2024-01-01", Description: "Salary", Amount: 5000, Category: "salary" },
        { Date: "2024-01-05", Description: "Rent", Amount: -1500, Category: "housing" },
      ],
      ["Date", "Description", "Amount", "Category"],
    );
    const { model, report } = normalize([t]);
    expect(model.transactions).toHaveLength(2);
    const salary = model.transactions[0]!;
    const rent = model.transactions[1]!;
    expect(salary.direction).toBe("inflow");
    expect(salary.amount).toBe(5000);
    expect(rent.direction).toBe("outflow");
    expect(rent.amount).toBe(1500);
    expect(report.transactionsParsed).toBe(2);
  });

  it("maps debit/credit columns and infers categories", () => {
    const t = table(
      [
        { "Posted Date": "05/01/2024", Narrative: "MONTHLY SALARY", Debit: "", Credit: "4800" },
        { "Posted Date": "07/01/2024", Narrative: "TESCO SUPERMARKET", Debit: "142.30", Credit: "" },
      ],
      ["Posted Date", "Narrative", "Debit", "Credit"],
    );
    const { model } = normalize([t]);
    expect(model.transactions).toHaveLength(2);
    expect(model.transactions[0]!.direction).toBe("inflow");
    expect(model.transactions[1]!.direction).toBe("outflow");
    // "TESCO SUPERMARKET" should categorize via keyword inference — not "uncategorized".
    expect(model.transactions[1]!.category).not.toBe("uncategorized");
  });

  it("skips rows with invalid dates or amounts and records a warning", () => {
    const t = table(
      [
        { Date: "2024-01-01", Description: "ok", Amount: 100 },
        { Date: "bad", Description: "bad date", Amount: 50 },
      ],
      ["Date", "Description", "Amount"],
    );
    const { model, report } = normalize([t]);
    expect(model.transactions).toHaveLength(1);
    expect(report.rowsSkipped).toBe(1);
    expect(report.warnings.some((w) => w.includes("skipped"))).toBe(true);
  });
});
