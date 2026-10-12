import { describe, it, expect } from "vitest";
import { analyzeFile, CurrencyMismatchError } from "../index.js";
import { ingest } from "../ingestion/index.js";
import { normalize } from "./index.js";
import { classifyAssetClass } from "./holdings.js";
import { rawTable, writeTempCsv } from "../testkit.js";

/** Regression tests for normalization defects found by the accuracy audit (docs/ACCURACY_VALIDATION.md §8). */

describe("debit and credit both populated (AV-07)", () => {
  it("skips the contradictory row with a reason instead of silently dropping the debit", () => {
    const t = rawTable(
      [{ Date: "2024-01-05", Debit: "100.00", Credit: "40.00" }, { Date: "2024-01-06", Debit: "10.00", Credit: "" }],
      ["Date", "Debit", "Credit"],
    );
    const { model, report } = normalize([t]);
    expect(model.transactions).toHaveLength(1);
    expect(model.transactions[0]!.amount).toBe(10);
    expect(report.skippedRows).toHaveLength(1);
    expect(report.skippedRows[0]!.reason).toMatch(/both debit and credit/);
  });
});

describe("currency carried by the amount (AV-06)", () => {
  it("labels a euro-only file EUR instead of the USD default", () => {
    const p = writeTempCsv("eur.csv", 'Date,Description,Amount\n2024-01-05,A,"€2,500.00"\n2024-01-09,B,-€700.35\n');
    const r = analyzeFile(p);
    expect(r.model.currency).toBe("EUR");
    expect(r.model.currencies).toEqual(["EUR"]);
  });
  it("refuses to sum $ and € amounts that have no currency column", () => {
    const p = writeTempCsv("mixed.csv", "Date,Description,Amount\n2024-01-01,A,$100.00\n2024-01-02,B,-€20.00\n");
    expect(() => analyzeFile(p)).toThrow(CurrencyMismatchError);
  });
  it("warns when a currency cell is not recognised instead of assuming the default silently", () => {
    const t = rawTable([{ Date: "2024-01-05", Amount: "-100", Currency: "Swiss Franc" }], ["Date", "Amount", "Currency"]);
    const { report } = normalize([t]);
    expect(report.warnings.join(" ")).toMatch(/unrecognised currency.*Swiss Franc/);
  });
});

describe("holdings value that contradicts quantity x price (AV-08)", () => {
  it("is reported", () => {
    const t = rawTable([{ Symbol: "X", Quantity: "10", Price: "100", Value: "5000", "Asset Class": "equity" }], ["Symbol", "Quantity", "Price", "Value", "Asset Class"], "holdings");
    const { model, report } = normalize([t]);
    expect(model.holdings[0]!.value).toBe(5000);
    expect(report.warnings.join(" ")).toMatch(/contradicts quantity x price/);
  });
  it("stays silent when the figures agree", () => {
    const t = rawTable([{ Symbol: "X", Quantity: "10", Price: "100", Value: "1000", "Asset Class": "equity" }], ["Symbol", "Quantity", "Price", "Value", "Asset Class"], "holdings");
    expect(normalize([t]).report.warnings).toEqual([]);
  });
});

describe("asset class wrappers (AV-09)", () => {
  it("does not let 'fund' / 'ETF' override a more specific class", () => {
    expect(classifyAssetClass("Money Market Fund")).toBe("cash");
    expect(classifyAssetClass("Bond ETF")).toBe("fixed_income");
    expect(classifyAssetClass("Gold ETF")).toBe("commodity");
    expect(classifyAssetClass("Real Estate Fund")).toBe("real_estate");
    expect(classifyAssetClass("Crypto ETF")).toBe("crypto");
    expect(classifyAssetClass("Hedge Fund")).toBe("alternative");
    expect(classifyAssetClass("Private Equity")).toBe("alternative");
    expect(classifyAssetClass("real_estate")).toBe("real_estate");
  });
  it("still maps plain funds and equities to equity", () => {
    expect(classifyAssetClass("Mutual Fund")).toBe("equity");
    expect(classifyAssetClass("Index ETF")).toBe("equity");
    expect(classifyAssetClass("Common Stock")).toBe("equity");
    expect(classifyAssetClass("Equity")).toBe("equity");
  });
});

describe("UTF-8 delimited text (AV-10)", () => {
  it("is decoded as UTF-8 (was Latin-1: '€' became 'â¬')", () => {
    const p = writeTempCsv("utf8.csv", "Date,Description,Amount\n2024-01-05,Café Über,€5.00\n");
    const row = ingest(p)[0]!.rows[0]!;
    expect(row["Description"]).toBe("Café Über");
    expect(row["Amount"]).toBe("€5.00");
  });
  it("tolerates a byte-order mark", () => {
    const p = writeTempCsv("bom.csv", "﻿Date,Description,Amount\n2024-01-05,A,5.00\n");
    expect(ingest(p)[0]!.headers).toEqual(["Date", "Description", "Amount"]);
  });
});

describe("invalid amounts and dates are recorded, never accepted (AV-01, AV-02)", () => {
  it("skips impossible dates and malformed amounts with a reason and keeps row conservation", () => {
    const p = writeTempCsv("bad.csv", "Date,Description,Amount\n2024-01-01,Good,100.00\n2024-02-30,Bad date,-5.00\n2024-01-03,Bad amount,1.2.3\n");
    const r = analyzeFile(p);
    expect(r.model.transactions).toHaveLength(1);
    expect(r.normalization.skippedRows.map((s) => s.row)).toEqual([1, 2]);
    expect(r.normalization.transactionsParsed + r.normalization.skippedRows.length).toBe(3);
  });
});
