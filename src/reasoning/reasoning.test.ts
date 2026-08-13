import { describe, it, expect } from "vitest";
import { runAnalyses } from "../analysis/index.js";
import { makeHolding, makeModel, makeTxn } from "../testkit.js";
import { reason, RULES } from "./engine.js";

const RULE_IDS = new Set(RULES.map((r) => r.id));

function insightsFor(...args: Parameters<typeof makeModel>) {
  const m = makeModel(...args);
  return reason(m, runAnalyses(m));
}

describe("reasoning traceability", () => {
  it("every insight is fully traceable (ruleId, evidence, basis, confidence)", () => {
    const insights = insightsFor(
      [
        makeTxn("2024-01-01", 5000, "salary"),
        makeTxn("2024-01-10", -4800, "shopping"),
        makeTxn("2024-02-01", 5000, "salary"),
        makeTxn("2024-02-10", -5200, "shopping"),
      ],
      [makeHolding("NVDA", 90000, "equity"), makeHolding("CASH", 500, "cash")],
    );
    expect(insights.length).toBeGreaterThan(0);
    for (const ins of insights) {
      expect(RULE_IDS.has(ins.ruleId)).toBe(true);
      expect(ins.evidence.length).toBeGreaterThan(0);
      expect(ins.basis.length).toBeGreaterThan(0);
      expect(ins.confidence).toBeGreaterThan(0);
      expect(ins.confidence).toBeLessThanOrEqual(1);
      // Every evidence item names the module it came from.
      for (const e of ins.evidence) expect(typeof e.module).toBe("string");
    }
  });
});

describe("reasoning does not fire on absent/zero data", () => {
  it("produces no insights for an empty model", () => {
    expect(insightsFor([])).toHaveLength(0);
  });

  it("holdings-only data produces no income/cash-flow insights", () => {
    const insights = insightsFor([], [makeHolding("ONE", 100000, "equity")]);
    const ids = insights.map((i) => i.ruleId);
    expect(ids).not.toContain("low-savings-driver");
    expect(ids).not.toContain("cashflow-decline-driver");
    expect(ids).not.toContain("healthy-position");
  });

  it("transactions-only data produces no portfolio insights", () => {
    const insights = insightsFor([
      makeTxn("2024-01-01", 5000, "salary"),
      makeTxn("2024-01-10", -4800, "shopping"),
    ]);
    const ids = insights.map((i) => i.ruleId);
    expect(ids).not.toContain("portfolio-concentration");
    expect(ids).not.toContain("thin-liquidity");
  });

  it("a concentrated portfolio yields a concentration insight sourced from that module", () => {
    const insights = insightsFor(
      [makeTxn("2024-01-01", 5000, "salary"), makeTxn("2024-01-10", -2000, "housing")],
      [makeHolding("BIG", 90000, "equity"), makeHolding("SMALL", 10000, "equity")],
    );
    const conc = insights.find((i) => i.ruleId === "portfolio-concentration");
    expect(conc).toBeDefined();
    expect(conc!.evidence.some((e) => e.module === "concentration")).toBe(true);
  });
});
