import { describe, it, expect } from "vitest";
import { runAnalyses } from "../analysis/index.js";
import { reason } from "./engine.js";
import { makeHolding, makeModel, makeTxn } from "../testkit.js";
import type { FinancialModel } from "../core/model.js";

/** Regression tests for reasoning-rule defects found by the accuracy audit (docs/ACCURACY_VALIDATION.md §8). */

const insights = (m: FinancialModel) => reason(m, runAnalyses(m));
const GROC = [42.1, 55.8, 47.25, 61, 39.9, 52.35, 48.7, 58.15, 44.6, 50.05];

describe("anomaly-impact cites the flagged one-off, not the largest recurring outflow (AV-12)", () => {
  // Rent 2000 x4 is the largest outflow but recurring; the only outlier is a 400 dental bill (4.5% of spend).
  const txns = [
    makeTxn("2024-01-01", 9000, "salary"),
    ...[1, 2, 3, 4].map((m) => makeTxn(`2024-0${m}-02`, -2000, "housing", { description: `Rent ${m}` })),
    ...GROC.map((a, i) => makeTxn(`2024-01-${String(i + 3).padStart(2, "0")}`, -a, "groceries")),
    makeTxn("2024-01-30", -400, "health", { description: "Dental" }),
  ];
  it("does not fire when the outlier is a small share of spending", () => {
    expect(insights(makeModel(txns)).some((i) => i.ruleId === "anomaly-impact")).toBe(false);
  });
  it("fires and cites the outlier (not the rent) when the outlier is large", () => {
    const big = [...txns.filter((t) => t.description !== "Dental"), makeTxn("2024-01-30", -3000, "health", { description: "Surgery" })];
    const i = insights(makeModel(big)).find((x) => x.ruleId === "anomaly-impact")!;
    expect(i.explanation).toMatch(/flagged outlier \(\$3,000\.00\)/);
    expect(i.explanation).not.toMatch(/2,000\.00/);
  });
});

describe("portfolio-concentration never names cash as the driver (AV-13)", () => {
  it("names the largest investment even when cash is the largest row", () => {
    const m = makeModel([makeTxn("2024-01-01", 1000), makeTxn("2024-01-02", -500)], [makeHolding("CASH", 500, "cash"), makeHolding("A", 300), makeHolding("B", 200)]);
    const i = insights(m).find((x) => x.ruleId === "portfolio-concentration")!;
    expect(i.explanation).toMatch(/driven mainly by A at/);
    expect(i.drivers.join(" ")).not.toMatch(/CASH/);
    expect(i.evidence.every((e) => e.label !== "CASH")).toBe(true);
    expect(i.evidence.length).toBeGreaterThan(0);
  });
});

describe("healthy-position needs a track record (AV-14)", () => {
  it("is not emitted from a single good month", () => {
    const m = makeModel([makeTxn("2024-01-01", 5000), makeTxn("2024-01-05", -1000)]);
    expect(insights(m).some((i) => i.ruleId === "healthy-position")).toBe(false);
  });
  it("is not emitted from two good months", () => {
    const m = makeModel([makeTxn("2024-01-01", 6000), makeTxn("2024-01-05", -1500), makeTxn("2024-02-01", 6000), makeTxn("2024-02-05", -1500)]);
    expect(insights(m).some((i) => i.ruleId === "healthy-position")).toBe(false);
  });
  it("is still emitted after three strong months", () => {
    const t = [1, 2, 3].flatMap((mo) => [makeTxn(`2024-0${mo}-01`, 6000), makeTxn(`2024-0${mo}-05`, -2000)]);
    const m = makeModel(t, [makeHolding("CASH", 30000, "cash"), makeHolding("E1", 20000), makeHolding("E2", 20000), makeHolding("B1", 20000, "fixed_income")]);
    expect(insights(m).some((i) => i.ruleId === "healthy-position")).toBe(true);
  });
});

describe("cashflow-decline-driver attributes the decline to what actually moved (AV-15)", () => {
  const month = (m: number, salary: number, dining: number) => [makeTxn(`2024-0${m}-01`, salary, "salary"), makeTxn(`2024-0${m}-03`, -1500, "housing", { description: "Rent" }), makeTxn(`2024-0${m}-14`, -dining, "dining")];
  it("does not blame spending when income fell and spending was flat", () => {
    const t = [...month(1, 5000, 200), ...month(2, 5000, 200), ...month(3, 5000, 200), ...month(4, 2500, 200), ...month(5, 2500, 200), ...month(6, 2500, 200)];
    const i = insights(makeModel(t)).find((x) => x.ruleId === "cashflow-decline-driver")!;
    expect(i.drivers).toEqual(["lower income in the recent period"]);
    expect(i.explanation).not.toMatch(/spending/i);
  });
  it("names the rising category when spending rose", () => {
    const t = [...month(1, 5000, 200), ...month(2, 5000, 200), ...month(3, 5000, 200), ...month(4, 5000, 2000), ...month(5, 5000, 2000), ...month(6, 5000, 2000)];
    const i = insights(makeModel(t)).find((x) => x.ruleId === "cashflow-decline-driver")!;
    expect(i.drivers).toEqual(["rising dining spend"]);
  });
  it("does not call a two-month change a trend", () => {
    const t = [...month(1, 5000, 200), ...month(2, 2000, 200)];
    expect(insights(makeModel(t)).some((x) => x.ruleId === "cashflow-decline-driver")).toBe(false);
  });
});
