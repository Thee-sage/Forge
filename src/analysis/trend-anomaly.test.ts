import { describe, it, expect } from "vitest";
import { findMetric } from "../core/result.js";
import { makeModel, makeTxn } from "../testkit.js";
import { analyzeTrends } from "./trend.js";
import { analyzeAnomalies } from "./anomaly.js";

describe("trend analysis does not over-claim", () => {
  it("makes no trend claim with a single month of data", () => {
    const r = analyzeTrends(makeModel([makeTxn("2024-01-01", 5000, "salary"), makeTxn("2024-01-10", -100, "food")]));
    expect(findMetric([r], "trend", "categoriesChanged")).toBe(0);
    expect(r.findings.every((f) => f.severity === "info")).toBe(true);
  });

  it("detects a rising category across six months", () => {
    const txns = [-50, -100, -150, -200, -250, -300].flatMap((amt, i) => {
      const mm = String(i + 1).padStart(2, "0");
      return [makeTxn(`2024-${mm}-01`, 5000, "salary"), makeTxn(`2024-${mm}-15`, amt, "dining")];
    });
    const r = analyzeTrends(makeModel(txns));
    expect(r.findings.some((f) => /dining/.test(f.message) && /rose/.test(f.message))).toBe(true);
  });
});

describe("anomaly detector edge cases", () => {
  it("does not run on very small datasets", () => {
    const r = analyzeAnomalies(
      makeModel([makeTxn("2024-01-01", 5000, "salary"), makeTxn("2024-01-10", -100, "food"), makeTxn("2024-01-11", -80, "food")]),
    );
    expect(findMetric([r], "anomaly", "anomalies")).toBe(0);
    expect(r.findings.every((f) => f.severity === "info")).toBe(true);
  });

  it("ignores a recurring subscription but flags a genuine spike", () => {
    const txns = [
      ...["01", "02", "03", "04", "05", "06"].map((mm) => makeTxn(`2024-${mm}-12`, -15.99, "subscriptions")),
      ...[-45, -52, -48, -60, -55, -50].map((amt, i) => makeTxn(`2024-0${i + 1}-10`, amt, "dining")),
      makeTxn("2024-05-19", -4000, "health"),
    ];
    const r = analyzeAnomalies(makeModel(txns));
    const labels = r.evidence.map((e) => e.label);
    expect(labels.some((l) => l.includes("health"))).toBe(true);
    expect(labels.every((l) => !l.includes("subscriptions"))).toBe(true);
  });

  it("does not crash when the variable baseline has zero deviation", () => {
    // Many identical variable amounts (mad = 0) plus one different value.
    const txns = [
      ...Array.from({ length: 6 }, (_, i) => makeTxn(`2024-0${i + 1}-10`, -100, "food")),
      makeTxn("2024-01-20", -100, "food"),
      makeTxn("2024-02-20", -5000, "health"),
    ];
    expect(() => analyzeAnomalies(makeModel(txns))).not.toThrow();
  });
});
