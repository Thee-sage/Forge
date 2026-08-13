import { describe, it, expect } from "vitest";
import { findMetric } from "../core/result.js";
import { makeHolding, makeModel, makeTxn } from "../testkit.js";
import { runAnalyses } from "./index.js";
import { analyzeCashflow } from "./cashflow.js";
import { analyzeConcentration } from "./concentration.js";
import { analyzeAnomalies } from "./anomaly.js";

describe("cashflow analysis", () => {
  it("computes inflow, outflow, net and savings rate", () => {
    const m = makeModel([
      makeTxn("2024-01-01", 5000, "salary"),
      makeTxn("2024-01-10", -2000, "housing"),
      makeTxn("2024-02-01", 5000, "salary"),
      makeTxn("2024-02-10", -3000, "housing"),
    ]);
    const r = analyzeCashflow(m);
    expect(findMetric([r], "cashflow", "inflow")).toBe(10000);
    expect(findMetric([r], "cashflow", "outflow")).toBe(5000);
    expect(findMetric([r], "cashflow", "net")).toBe(5000);
    expect(findMetric([r], "cashflow", "savingsRate")).toBeCloseTo(0.5, 5);
  });

  it("flags negative overall cash flow as critical", () => {
    const m = makeModel([
      makeTxn("2024-01-01", 1000, "salary"),
      makeTxn("2024-01-10", -3000, "shopping"),
    ]);
    const r = analyzeCashflow(m);
    expect(r.findings.some((f) => f.severity === "critical")).toBe(true);
  });
});

describe("concentration analysis", () => {
  it("computes HHI and flags a dominant position", () => {
    const m = makeModel([], [makeHolding("BIG", 90000), makeHolding("SMALL", 10000)]);
    const r = analyzeConcentration(m);
    const hhi = findMetric([r], "concentration", "hhi")!;
    expect(hhi).toBeCloseTo(0.82, 2); // 0.9^2 + 0.1^2
    expect(r.findings.some((f) => f.severity === "critical")).toBe(true);
  });

  it("stays quiet for a diversified portfolio", () => {
    const holdings = Array.from({ length: 10 }, (_, i) => makeHolding(`H${i}`, 10000));
    const r = analyzeConcentration(makeModel([], holdings));
    expect(findMetric([r], "concentration", "hhi")).toBeCloseTo(0.1, 5);
    expect(r.findings.every((f) => f.severity === "info")).toBe(true);
  });
});

describe("anomaly analysis", () => {
  it("flags a one-off spike but ignores recurring identical amounts", () => {
    const txns = [
      // Recurring rent (identical amount x6) must NOT be flagged as anomalies.
      ...["01", "02", "03", "04", "05", "06"].map((mm) => makeTxn(`2024-${mm}-03`, -1500, "housing")),
      // Small routine spend (naturally varying) to build a low baseline.
      ...[-45, -55, -48, -60, -52, -58].map((amt, i) => makeTxn(`2024-0${i + 1}-10`, amt, "dining")),
      // A genuine one-off spike.
      makeTxn("2024-05-19", -3500, "health"),
    ];
    const r = analyzeAnomalies(makeModel(txns));
    const flagged = r.evidence.map((e) => e.label);
    expect(flagged.some((l) => l.includes("health"))).toBe(true);
    expect(flagged.every((l) => !l.includes("housing"))).toBe(true);
  });
});

describe("runAnalyses", () => {
  it("runs every module and returns one result each", () => {
    const results = runAnalyses(makeModel([makeTxn("2024-01-01", 5000, "salary")]));
    expect(results.map((r) => r.module)).toEqual([
      "health",
      "cashflow",
      "expenditure",
      "trend",
      "anomaly",
      "allocation",
      "concentration",
    ]);
  });
});
