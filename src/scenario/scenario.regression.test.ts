import { describe, it, expect } from "vitest";
import { ForgeError } from "../core/errors.js";
import { applyScenario, simulate, ScenarioError } from "./simulate.js";
import { runAnalyses } from "../analysis/index.js";
import { makeHolding, makeModel, makeTxn } from "../testkit.js";

/** Regression tests for scenario defects found by the accuracy audit (docs/ACCURACY_VALIDATION.md §8). */

const model = () => makeModel([makeTxn("2024-01-01", 3000, "salary"), makeTxn("2024-01-10", -900, "housing")]);

describe("invalid scenarios are rejected (AV-16)", () => {
  it("rejects a change below -100% (was: negative amounts)", () => {
    expect(() => applyScenario(model(), { incomePct: -1.5 })).toThrow(ScenarioError);
    expect(() => simulate(model(), { expensePct: -2 })).toThrow(ScenarioError);
  });
  it("rejects non-finite and negative amounts (was: Infinity amounts)", () => {
    expect(() => applyScenario(model(), { recurringExpense: { amount: Infinity, category: "x" } })).toThrow(ScenarioError);
    expect(() => applyScenario(model(), { oneOffExpense: { amount: NaN, category: "x" } })).toThrow(ScenarioError);
    expect(() => applyScenario(model(), { oneOffExpense: { amount: -50, category: "x" } })).toThrow(ScenarioError);
    expect(() => applyScenario(model(), { incomePct: NaN })).toThrow(ScenarioError);
  });
  it("is a ForgeError, so the CLI and web server render it cleanly", () => {
    expect(new ScenarioError("x")).toBeInstanceOf(ForgeError);
  });
  it("still allows -100% (income removed) and ordinary changes", () => {
    const out = applyScenario(model(), { incomePct: -1 });
    expect(out.transactions.every((t) => t.amount >= 0)).toBe(true);
    expect(() => applyScenario(model(), { incomePct: 0.5, expensePct: -0.5 })).not.toThrow();
  });
  it("does not mutate the model it was given", () => {
    const m = model();
    const before = JSON.stringify(m);
    simulate(m, { incomePct: 0.1, expensePct: 0.2, recurringExpense: { amount: 10, category: "x" }, oneOffExpense: { amount: 10, category: "x" } });
    expect(JSON.stringify(m)).toBe(before);
  });
});

describe("a metric Forge could not compute is not compared against 0 (AV-17)", () => {
  it("omits the runway delta when the baseline has no spending, and says why", () => {
    // Income only + cash: no outflow, so no runway in the baseline. A one-off expense then creates one.
    const m = makeModel([makeTxn("2024-01-01", 1000, "salary"), makeTxn("2024-02-01", 1000, "salary")], [makeHolding("CASH", 6000, "cash")]);
    const r = simulate(m, { oneOffExpense: { amount: 1000, category: "repairs" } });
    expect(r.deltas.find((d) => d.key === "health.runwayMonths")).toBeUndefined();
    expect(r.unavailable.find((u) => u.key === "health.runwayMonths")!.reason).toMatch(/baseline/);
  });
  it("omits score and savings-rate deltas when the scenario removes all income", () => {
    const m = makeModel([makeTxn("2024-01-01", 3000, "salary"), makeTxn("2024-01-10", -900, "housing")]);
    const r = simulate(m, { incomePct: -1 });
    expect(r.deltas.find((d) => d.key === "health.score")).toBeUndefined();
    expect(r.deltas.find((d) => d.key === "cashflow.savingsRate")).toBeUndefined();
    expect(r.explanation).toMatch(/health score is not available for the scenario/);
    expect(r.explanation).not.toMatch(/to 0\/100/);
  });
  it("keeps every delta when both sides are measurable", () => {
    const m = makeModel([makeTxn("2024-01-01", 3000, "salary"), makeTxn("2024-01-10", -900, "housing"), makeTxn("2024-02-01", 3000, "salary"), makeTxn("2024-02-10", -900, "housing")], [makeHolding("CASH", 3000, "cash"), makeHolding("E", 5000)]);
    const r = simulate(m, { expensePct: 0.1 });
    expect(r.deltas.map((d) => d.key).sort()).toEqual(["cashflow.avgMonthlyNet", "cashflow.net", "cashflow.savingsRate", "health.runwayMonths", "health.score"]);
    expect(r.unavailable).toEqual([]);
  });
  it("a baseline scenario equals the unmodified baseline", () => {
    const m = makeModel([makeTxn("2024-01-01", 3000, "salary"), makeTxn("2024-01-10", -900, "housing")], [makeHolding("CASH", 3000, "cash")]);
    const r = simulate(m, {});
    expect(r.deltas.every((d) => d.delta === 0)).toBe(true);
    expect(JSON.stringify(r.scenarioResults)).toBe(JSON.stringify(runAnalyses(m)));
  });
});
