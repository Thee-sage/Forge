import { describe, it, expect } from "vitest";
import { findMetric } from "../core/result.js";
import { runAnalyses } from "../analysis/index.js";
import { reason } from "../reasoning/engine.js";
import { makeHolding, makeModel, makeTxn } from "../testkit.js";
import { applyScenario, simulate } from "./simulate.js";

function steadyModel() {
  return makeModel([
    makeTxn("2024-01-01", 5000, "salary"),
    makeTxn("2024-01-10", -2000, "housing"),
    makeTxn("2024-02-01", 5000, "salary"),
    makeTxn("2024-02-10", -2000, "housing"),
    makeTxn("2024-03-01", 5000, "salary"),
    makeTxn("2024-03-10", -2000, "housing"),
  ]);
}

describe("scenario simulation", () => {
  it("a 20% income cut reduces net cash flow by exactly the removed income", () => {
    const m = steadyModel();
    const base = runAnalyses(m);
    const result = simulate(m, { incomePct: -0.2 }, base);
    const netDelta = result.deltas.find((d) => d.key === "cashflow.net")!;
    expect(netDelta.delta).toBeCloseTo(-3000, 5); // 15000 income * 20%
  });

  it("a recurring expense lowers the health score", () => {
    const m = steadyModel();
    const base = runAnalyses(m);
    const baseScore = findMetric(base, "health", "score")!;
    const result = simulate(m, { recurringExpense: { amount: 1500, category: "rent" } }, base);
    const scenScore = result.deltas.find((d) => d.key === "health.score")!.scenario;
    expect(scenScore).toBeLessThanOrEqual(baseScore);
  });

  it("does not mutate the original model", () => {
    const m = steadyModel();
    const before = m.transactions.length;
    const snapshot = JSON.stringify(m);
    simulate(m, { expensePct: 0.5, incomePct: -0.3, oneOffExpense: { amount: 999, category: "x" } });
    expect(m.transactions.length).toBe(before);
    expect(JSON.stringify(m)).toBe(snapshot); // fully unchanged
  });

  it("only changes the intended variable (expenses up leaves income untouched)", () => {
    const m = steadyModel();
    const base = runAnalyses(m);
    const result = simulate(m, { expensePct: 0.2 }, base);
    expect(result.deltas.find((d) => d.key === "cashflow.net")!.delta).toBeLessThan(0);
    // Inflow is unchanged: baseline income equals scenario income.
    const scenModel = applyScenario(m, { expensePct: 0.2 });
    const baseIn = m.transactions.filter((t) => t.direction === "inflow").reduce((a, t) => a + t.amount, 0);
    const scenIn = scenModel.transactions.filter((t) => t.direction === "inflow").reduce((a, t) => a + t.amount, 0);
    expect(scenIn).toBeCloseTo(baseIn, 5);
  });

  it("is deterministic: identical spec yields identical deltas", () => {
    const m = steadyModel();
    const a = simulate(m, { incomePct: -0.1, expensePct: 0.05 });
    const b = simulate(m, { incomePct: -0.1, expensePct: 0.05 });
    expect(JSON.stringify(a.deltas)).toBe(JSON.stringify(b.deltas));
  });

  it("works against transaction+portfolio data (runway participates)", () => {
    const m = makeModel(steadyModel().transactions, [
      makeHolding("CASH", 4000, "cash"),
      makeHolding("VOO", 20000, "equity"),
    ]);
    const result = simulate(m, { oneOffExpense: { amount: 3000, category: "medical" } });
    // A one-off expense should not increase the health score.
    const scoreDelta = result.deltas.find((d) => d.key === "health.score")!;
    expect(scoreDelta.scenario).toBeLessThanOrEqual(scoreDelta.baseline);
  });
});

describe("reasoning engine (via scenario module models)", () => {
  it("emits a healthy-position insight for strong finances, with traceability", () => {
    const m = steadyModel(); // 60% savings rate
    const results = runAnalyses(m);
    const insights = reason(m, results);
    const strong = insights.find((i) => i.headline.includes("strong footing"));
    expect(strong).toBeDefined();
    expect(strong!.ruleId).toBe("healthy-position");
    expect(strong!.evidence.length).toBeGreaterThan(0);
    expect(strong!.basis).toContain("health");
  });
});
