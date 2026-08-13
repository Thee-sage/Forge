import { describe, it, expect } from "vitest";
import { findMetric } from "../core/result.js";
import { makeHolding, makeModel, makeTxn } from "../testkit.js";
import { analyzeHealth } from "./health.js";

const score = (m: Parameters<typeof analyzeHealth>[0]) =>
  findMetric([analyzeHealth(m)], "health", "score");

describe("health score — missing data does not fabricate", () => {
  it("emits NO score for an empty model and says so", () => {
    const r = analyzeHealth(makeModel([]));
    expect(findMetric([r], "health", "score")).toBeUndefined();
    expect(r.findings.some((f) => /insufficient data/i.test(f.message))).toBe(true);
  });

  it("emits NO health score for holdings-only data (no cash-flow context)", () => {
    const r = analyzeHealth(makeModel([], [makeHolding("VOO", 50000, "equity")]));
    expect(findMetric([r], "health", "score")).toBeUndefined();
    expect(r.findings.some((f) => /portfolio metrics only/i.test(f.message))).toBe(true);
  });

  it("scores transactions-only data but marks liquidity/diversification not assessed", () => {
    const r = analyzeHealth(
      makeModel([
        makeTxn("2024-01-01", 5000, "salary"),
        makeTxn("2024-01-10", -2000, "housing"),
        makeTxn("2024-02-01", 5000, "salary"),
        makeTxn("2024-02-10", -2000, "housing"),
      ]),
    );
    expect(findMetric([r], "health", "score")).toBeGreaterThan(0);
    expect(findMetric([r], "health", "runwayMonths")).toBeUndefined();
    expect(findMetric([r], "health", "diversificationScore")).toBeUndefined();
    expect(r.findings.some((f) => /not assessed/i.test(f.message))).toBe(true);
  });
});

describe("health score — a critical weakness cannot hide behind strong dimensions", () => {
  it("caps the score when spending exceeds income, even with stable months", () => {
    const m = makeModel([
      makeTxn("2024-01-01", 10000, "salary"),
      makeTxn("2024-01-15", -11000, "shopping"),
      makeTxn("2024-02-01", 10000, "salary"),
      makeTxn("2024-02-15", -11000, "shopping"),
      makeTxn("2024-03-01", 10000, "salary"),
      makeTxn("2024-03-15", -11000, "shopping"),
    ]);
    const r = analyzeHealth(m);
    expect(findMetric([r], "health", "score")!).toBeLessThanOrEqual(45);
    expect(r.findings.some((f) => /capped/i.test(f.message) && f.severity === "critical")).toBe(true);
  });

  it("caps the score for a sub-1-month cash runway despite an 80% savings rate", () => {
    const txns = [
      makeTxn("2024-01-01", 10000, "salary"),
      makeTxn("2024-01-10", -2000, "housing"),
      makeTxn("2024-02-01", 10000, "salary"),
      makeTxn("2024-02-10", -2000, "housing"),
      makeTxn("2024-03-01", 10000, "salary"),
      makeTxn("2024-03-10", -2000, "housing"),
    ];
    const m = makeModel(txns, [makeHolding("VOO", 100000, "equity"), makeHolding("CASH", 100, "cash")]);
    const r = analyzeHealth(m);
    // Savings rate is 80% yet the score is held down by near-zero liquidity.
    expect(findMetric([r], "health", "savingsScore")).toBe(1);
    expect(findMetric([r], "health", "score")!).toBeLessThanOrEqual(55);
    expect(r.findings.some((f) => /capped/i.test(f.message) && /runway/i.test(f.message))).toBe(true);
  });

  it("caps the score when most months are cash-flow negative", () => {
    const m = makeModel([
      makeTxn("2024-01-01", 3000, "salary"),
      makeTxn("2024-01-10", -3100, "housing"),
      makeTxn("2024-02-01", 3000, "salary"),
      makeTxn("2024-02-10", -3100, "housing"),
      makeTxn("2024-03-01", 3000, "salary"),
      makeTxn("2024-03-10", -3100, "housing"),
      makeTxn("2024-04-01", 3000, "salary"),
      makeTxn("2024-04-10", -2500, "housing"),
    ]);
    const r = analyzeHealth(m);
    expect(findMetric([r], "health", "score")!).toBeLessThanOrEqual(55);
  });
});

describe("health score — sub-scores reflect the data", () => {
  it("reflects a concentrated portfolio in a low diversification sub-score", () => {
    const m = makeModel(
      [makeTxn("2024-01-01", 5000, "salary"), makeTxn("2024-01-10", -2000, "housing")],
      [makeHolding("ONE", 100000, "equity")],
    );
    const r = analyzeHealth(m);
    expect(findMetric([r], "health", "diversificationScore")).toBeCloseTo(0, 5);
  });

  it("a healthier profile scores strictly higher than a strained one", () => {
    const healthy = makeModel([
      makeTxn("2024-01-01", 5000, "salary"),
      makeTxn("2024-01-10", -2000, "housing"),
      makeTxn("2024-02-01", 5000, "salary"),
      makeTxn("2024-02-10", -2000, "housing"),
    ]);
    const strained = makeModel([
      makeTxn("2024-01-01", 5000, "salary"),
      makeTxn("2024-01-10", -4800, "housing"),
      makeTxn("2024-02-01", 5000, "salary"),
      makeTxn("2024-02-10", -4800, "housing"),
    ]);
    expect(score(healthy)!).toBeGreaterThan(score(strained)!);
  });
});
