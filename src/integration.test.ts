import { describe, it, expect } from "vitest";
import { analyzeFile, ingest, IngestionError } from "./index.js";
import { CurrencyMismatchError } from "./core/currency.js";
import { normalize } from "./normalize/index.js";
import { writeTempCsv } from "./testkit.js";

const TXNS = `Date,Description,Amount,Category
2024-01-01,Salary,5000,salary
2024-01-05,Rent,-1500,housing
2024-02-01,Salary,5000,salary
2024-02-05,Rent,-1500,housing`;

const HOLDINGS = `Symbol,Name,Asset Class,Market Value,Currency
VOO,Vanguard,Equity,20000,USD
CASH,Cash,Cash,4000,USD`;

describe("multi-file ingestion & provenance", () => {
  it("merges transactions + holdings and preserves per-entity source provenance", () => {
    const txnPath = writeTempCsv("txns.csv", TXNS);
    const holdPath = writeTempCsv("holdings.csv", HOLDINGS);
    const report = analyzeFile([txnPath, holdPath]);

    expect(report.model.transactions.length).toBe(4);
    expect(report.model.holdings.length).toBe(2);
    expect(report.model.meta.sources.sort()).toEqual([holdPath, txnPath].sort());
    expect(report.model.transactions.every((t) => t.source === txnPath)).toBe(true);
    expect(report.model.holdings.every((h) => h.source === holdPath)).toBe(true);
  });

  it("merges two transaction files deterministically", () => {
    const a = writeTempCsv("a.csv", TXNS);
    const b = writeTempCsv("b.csv", TXNS);
    const r1 = analyzeFile([a, b]);
    const r2 = analyzeFile([a, b]);
    expect(r1.model.transactions.length).toBe(8);
    expect(JSON.stringify(r1.analyses)).toBe(JSON.stringify(r2.analyses));
    expect(JSON.stringify(r1.insights)).toBe(JSON.stringify(r2.insights));
  });
});

describe("cross-file currency integrity", () => {
  it("fails clearly when one file is INR and another USD", () => {
    const inr = writeTempCsv(
      "inr.csv",
      `Date,Description,Amount,Currency\n2024-01-01,Salary,5000,INR\n2024-01-05,Rent,-1500,INR`,
    );
    const usd = writeTempCsv("usd.csv", HOLDINGS);
    expect(() => analyzeFile([inr, usd])).toThrow(CurrencyMismatchError);
  });
});

describe("file-level robustness", () => {
  it("throws a clean IngestionError for an empty file", () => {
    const empty = writeTempCsv("empty.csv", "");
    expect(() => ingest(empty)).toThrow(IngestionError);
  });

  it("throws a clean IngestionError for a missing file", () => {
    expect(() => ingest("this/does/not/exist.csv")).toThrow(IngestionError);
  });
});

describe("normalization invariants", () => {
  const base = [{ Date: "2024-01-01", Description: "pay", n: 1000 }];
  function inflowFor(amountHeader: string, value: unknown): number {
    const rows = [{ Date: "2024-01-01", Description: "pay", [amountHeader]: value }];
    const { model } = normalize([
      { name: "t", source: "t", headers: ["Date", "Description", amountHeader], rows, shape: "transactions" },
    ]);
    return model.transactions.filter((t) => t.direction === "inflow").reduce((a, t) => a + t.amount, 0);
  }

  it("total inflow is invariant to the amount header alias used", () => {
    expect(inflowFor("Amount", 1000)).toBe(1000);
    expect(inflowFor("amount", 1000)).toBe(1000);
    expect(inflowFor("Transaction Amount", 1000)).toBe(1000);
    expect(inflowFor("Value", 1000)).toBe(1000);
    void base;
  });

  it("total inflow is invariant to amount formatting", () => {
    expect(inflowFor("Amount", "$1,000")).toBe(1000);
    expect(inflowFor("Amount", "1000")).toBe(1000);
    expect(inflowFor("Amount", "1000.00")).toBe(1000);
  });
});
