import { describe, it, expect } from "vitest";
import { findMetric } from "../core/result.js";
import { makeHolding, makeModel } from "../testkit.js";
import { analyzeAllocation } from "./allocation.js";
import { analyzeConcentration } from "./concentration.js";

function classWeightSum(model: Parameters<typeof analyzeAllocation>[0]): number {
  const r = analyzeAllocation(model);
  return r.metrics
    .filter((m) => m.key.startsWith("weight_"))
    .reduce((a, m) => a + m.value, 0);
}

describe("allocation invariants", () => {
  it("class weights sum to ~1 for varied portfolios", () => {
    const m = makeModel([], [
      makeHolding("A", 40000, "equity"),
      makeHolding("B", 30000, "fixed_income"),
      makeHolding("C", 20000, "cash"),
      makeHolding("D", 10000, "commodity"),
    ]);
    expect(classWeightSum(m)).toBeCloseTo(1, 6);
  });

  it("handles 100+ holdings and still sums to ~1", () => {
    const holdings = Array.from({ length: 120 }, (_, i) => makeHolding(`H${i}`, 1000 + i, "equity"));
    expect(classWeightSum(makeModel([], holdings))).toBeCloseTo(1, 6);
  });
});

describe("concentration invariants", () => {
  it("single holding => HHI 1, one effective position, critical market concentration", () => {
    const r = analyzeConcentration(makeModel([], [makeHolding("ONE", 50000, "equity")]));
    expect(findMetric([r], "concentration", "hhi")).toBeCloseTo(1, 6);
    expect(findMetric([r], "concentration", "effectivePositions")).toBeCloseTo(1, 6);
    expect(findMetric([r], "concentration", "riskHhi")).toBeCloseTo(1, 6);
    expect(r.findings.some((f) => f.severity === "critical")).toBe(true);
  });

  it("HHI stays within [1/n, 1] and effectivePositions ~ 1/HHI", () => {
    const n = 8;
    const holdings = Array.from({ length: n }, (_, i) => makeHolding(`H${i}`, 1000 * (i + 1), "equity"));
    const r = analyzeConcentration(makeModel([], holdings));
    const hhi = findMetric([r], "concentration", "hhi")!;
    expect(hhi).toBeGreaterThanOrEqual(1 / n - 1e-9);
    expect(hhi).toBeLessThanOrEqual(1 + 1e-9);
    expect(findMetric([r], "concentration", "effectivePositions")).toBeCloseTo(1 / hhi, 6);
  });
});

describe("cash is not a market-concentration risk (semantic hardening)", () => {
  it("100% cash raises no critical concentration and reads as low market risk", () => {
    const m = makeModel([], [makeHolding("CASH", 100000, "cash")]);
    const conc = analyzeConcentration(m);
    expect(findMetric([conc], "concentration", "riskHhi")).toBe(0);
    expect(conc.findings.every((f) => f.severity !== "critical" && f.severity !== "warning")).toBe(true);
    expect(conc.findings.some((f) => /entirely cash/i.test(f.message))).toBe(true);

    const alloc = analyzeAllocation(m);
    // A dominant cash position is a notice (return drag), not a diversification warning.
    expect(alloc.findings.some((f) => /mostly cash/i.test(f.message) && f.severity === "notice")).toBe(true);
    expect(alloc.findings.every((f) => f.severity !== "warning")).toBe(true);
  });

  it("a portfolio that is one equity IS flagged as concentrated", () => {
    const conc = analyzeConcentration(makeModel([], [makeHolding("EQ", 100000, "equity")]));
    expect(conc.findings.some((f) => f.severity === "critical")).toBe(true);
  });

  it("cash does not inflate market concentration when mixed with investments", () => {
    // 50% cash + 5 equal equities: non-cash HHI = 5 * 0.2^2 = 0.2 (not concentrated),
    // even though overall HHI is higher because of the big cash slice.
    const holdings = [
      makeHolding("CASH", 50000, "cash"),
      ...Array.from({ length: 5 }, (_, i) => makeHolding(`E${i}`, 10000, "equity")),
    ];
    const r = analyzeConcentration(makeModel([], holdings));
    expect(findMetric([r], "concentration", "riskHhi")).toBeCloseTo(0.2, 6);
    expect(r.findings.some((f) => f.severity === "critical")).toBe(false);
  });
});
