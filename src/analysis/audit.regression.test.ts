import { describe, it, expect } from "vitest";
import { runAnalyses } from "./index.js";
import { findMetric } from "../core/result.js";
import { makeHolding, makeModel, makeTxn } from "../testkit.js";

/** Regression tests for analysis defects found by the accuracy audit (docs/ACCURACY_VALIDATION.md §8). */

const anomalies = (txns: ReturnType<typeof makeTxn>[]) => runAnalyses(makeModel(txns)).find((r) => r.module === "anomaly")!;

describe("anomaly detection when most variable amounts are identical (AV-03)", () => {
  // Variable spend 10, 10, 10.5 plus a recurring 100 x3 (excluded). MAD is 0, which used to be
  // replaced by 1e-9 and flag 10.50 as "337,250,000x typical".
  const base = [
    makeTxn("2024-01-01", 3000, "salary"),
    makeTxn("2024-01-02", -10, "dining", { description: "Tea A" }),
    makeTxn("2024-01-03", -10, "dining", { description: "Tea B" }),
    makeTxn("2024-01-04", -10.5, "dining", { description: "Tea C" }),
    makeTxn("2024-01-05", -100, "utilities"),
    makeTxn("2024-02-05", -100, "utilities"),
    makeTxn("2024-03-05", -100, "utilities"),
  ];
  it("does not flag a value 5% above its cluster", () => {
    const a = anomalies(base);
    expect(a.findings.some((f) => /Tea C/.test(f.message) || /10\.50/.test(f.message))).toBe(false);
    expect(findMetric([a], "anomaly", "anomalies")).toBe(0);
  });
  it("never reports an absurd multiple", () => {
    for (const f of anomalies(base).findings) expect(f.message).not.toMatch(/\d{6,}/);
  });
  it("flags nothing when every variable amount is identical", () => {
    const same = [makeTxn("2024-01-01", 3000, "salary"), ...Array.from({ length: 2 }, (_, i) => makeTxn(`2024-01-0${i + 2}`, -50, "misc")), makeTxn("2024-01-05", -500, "misc"), makeTxn("2024-01-06", -500, "misc"), makeTxn("2024-01-07", -500, "misc")];
    expect(findMetric([anomalies(same)], "anomaly", "anomalies")).toBe(0);
  });
});

describe("anomaly message states a real multiple (AV-04)", () => {
  it("reports amount / median, not the modified z-score, as the multiple", () => {
    const amounts = [42.1, 55.8, 47.25, 61, 39.9, 52.35, 48.7, 58.15, 44.6, 50.05, 53.4, 46.3];
    const txns = [makeTxn("2024-01-01", 4000, "salary"), ...amounts.map((a, i) => makeTxn(`2024-01-${String(i + 2).padStart(2, "0")}`, -a, "groceries")), makeTxn("2024-01-28", -900, "health", { description: "Surgery" })];
    const a = anomalies(txns);
    const med = findMetric([a], "anomaly", "medianOutflow")!;
    const finding = a.findings.find((f) => /Surgery|900/.test(f.message))!;
    const times = Number(/(\d+(?:\.\d+)?)× the typical/.exec(finding.message)![1]);
    expect(times).toBeCloseTo(900 / med, 1);
    expect(finding.message).toMatch(/modified z-score/);
  });
});

describe("savings rate with no income (AV-05)", () => {
  it("states that the 0% is 'not measurable' rather than leaving a silent zero", () => {
    const r = runAnalyses(makeModel([makeTxn("2024-01-03", -500), makeTxn("2024-02-03", -500)])).find((x) => x.module === "cashflow")!;
    expect(r.metrics.find((m) => m.key === "savingsRate")!.value).toBe(0);
    expect(r.findings.some((f) => f.severity === "info" && /undefined.*no income/i.test(f.message))).toBe(true);
  });
  it("does not add that finding when income exists", () => {
    const r = runAnalyses(makeModel([makeTxn("2024-01-03", 1000), makeTxn("2024-01-04", -500)])).find((x) => x.module === "cashflow")!;
    expect(r.findings.some((f) => /undefined/.test(f.message))).toBe(false);
  });
  it("explains a holdings-only portfolio too", () => {
    const r = runAnalyses(makeModel([], [makeHolding("A", 100)])).find((x) => x.module === "cashflow")!;
    expect(r.findings.some((f) => /No transactions/.test(f.message))).toBe(true);
  });
});

describe("a brand-new category did not 'rise 100%' (AV-11)", () => {
  it("says it is new", () => {
    const txns = [
      makeTxn("2024-01-01", 4000, "salary"), makeTxn("2024-02-01", 4000, "salary"), makeTxn("2024-03-01", 4000, "salary"), makeTxn("2024-04-01", 4000, "salary"),
      makeTxn("2024-01-02", -1200, "housing"), makeTxn("2024-02-02", -1200, "housing"), makeTxn("2024-03-02", -1200, "housing"), makeTxn("2024-04-02", -1200, "housing"),
      makeTxn("2024-03-20", -600, "travel"), makeTxn("2024-04-20", -600, "travel"),
    ];
    const t = runAnalyses(makeModel(txns)).find((x) => x.module === "trend")!;
    const f = t.findings.find((x) => /travel/.test(x.message))!;
    expect(f.message).toMatch(/rose from nothing to .*600\.00.*new category/);
    expect(f.message).not.toMatch(/100%/);
    expect(t.evidence.find((e) => e.label === "travel")!.detail).toMatch(/\(new\)/);
  });
});
