import { describe, expect, it } from "vitest";
import { makeHolding, makeModel, makeTxn } from "../testkit.js";
import { runAnalyses } from "../analysis/index.js";
import { reason } from "../reasoning/engine.js";
import { normalize } from "../normalize/index.js";
import { simulate } from "../scenario/simulate.js";
import type { ForgeReport } from "../index.js";
import { buildReportView, buildScenarioView } from "./viewmodel.js";

/**
 * The view model is the web interface's whole contract with the engine: if it is honest,
 * the browser cannot be dishonest, because the browser only prints what it is given.
 * These tests pin the invariants that matter — no fabricated score, no invented figures,
 * every gap explained (DATA_MODEL.md §9, PROJECT_RULES §5/§10).
 */

function reportFor(model: ReturnType<typeof makeModel>): ForgeReport {
  const analyses = runAnalyses(model);
  return {
    model,
    normalization: normalize([]).report,
    analyses,
    insights: reason(model, analyses),
  };
}

/** Six months of salary and spending, plus a lopsided portfolio. */
function richModel() {
  const txns = [];
  for (let m = 1; m <= 6; m++) {
    const mm = String(m).padStart(2, "0");
    txns.push(makeTxn(`2024-${mm}-01`, 6000, "salary"));
    txns.push(makeTxn(`2024-${mm}-05`, -2200, "housing"));
    txns.push(makeTxn(`2024-${mm}-11`, -600 - m * 90, "food"));
    txns.push(makeTxn(`2024-${mm}-19`, -400, "transport"));
  }
  const holdings = [
    makeHolding("NVDA", 94000),
    makeHolding("VTI", 42000),
    makeHolding("BND", 18000, "fixed_income"),
    makeHolding("CASH", 12000, "cash"),
  ];
  return makeModel(txns, holdings);
}

describe("buildReportView", () => {
  it("renders the overview band, relations and findings from engine output only", () => {
    const report = reportFor(richModel());
    const view = buildReportView(report);

    expect(view.meta.currency).toBe("USD");
    expect(view.meta.months).toBe(6);
    expect(view.band).toHaveLength(4);
    expect(view.band[0]?.label).toBe("Inflow");
    expect(view.band[0]?.value).toContain("$");
    // Every finding is one of the engine's insights — the view invents none.
    expect(view.findings.map((f) => f.id).sort()).toEqual(report.insights.map((i) => i.ruleId).sort());
    for (const f of view.findings) {
      expect(f.evidence.length).toBeGreaterThan(0); // C6: traceable insights
      expect(f.basis.length).toBeGreaterThan(0);
    }
  });

  it("shows a health score only when the engine emitted one", () => {
    const withScore = buildReportView(reportFor(richModel()));
    const scoreTile = withScore.band[3];
    expect(scoreTile?.label).toBe("Health score");
    expect(scoreTile?.value).not.toBe("—");
    expect(scoreTile?.bar).toBeDefined();

    // A holdings-only model has no cash-flow data, so the engine emits no score (C4).
    const holdingsOnly = makeModel([], [makeHolding("VTI", 1000)]);
    const withoutScore = buildReportView(reportFor(holdingsOnly));
    const emptyTile = withoutScore.band[3];
    expect(emptyTile?.value).toBe("—");
    expect(emptyTile?.sub).toBe("not assessed");
    expect(emptyTile?.bar).toBeUndefined();
    expect(withoutScore.unavailable.some((u) => u.tag === "Health score")).toBe(true);
  });

  it("names what could not be assessed instead of showing a zero", () => {
    const noHoldings = makeModel([makeTxn("2024-01-01", 500, "salary")]);
    const view = buildReportView(reportFor(noHoldings));

    expect(view.portfolio.holdings).toHaveLength(0);
    expect(view.portfolio.concentration).toHaveLength(0);
    expect(view.unavailable.some((u) => u.tag === "Portfolio")).toBe(true);
  });

  it("keeps cash out of the concentration measure and flags a lopsided portfolio", () => {
    const view = buildReportView(reportFor(richModel()));
    const hhi = view.portfolio.concentration.find((c) => c.label.includes("HHI"));

    expect(hhi).toBeDefined();
    expect(view.portfolio.concentrationFlagged).toBe(true);
    expect(view.portfolio.allocation.some((a) => a.isCash)).toBe(true);
    // The cash row exists but the concentration note says it is excluded (C5).
    expect(view.portfolio.concentration.some((c) => /Cash excluded/.test(c.note))).toBe(true);
  });

  it("builds a monthly series and a period comparison from the transactions", () => {
    const view = buildReportView(reportFor(richModel()));

    expect(view.cashflow.months).toHaveLength(6);
    expect(view.cashflow.months[0]?.label).toBe("Jan 24");
    for (const m of view.cashflow.months) {
      expect(m.inflowScale).toBeGreaterThan(0);
      expect(m.inflowScale).toBeLessThanOrEqual(1);
    }
    expect(view.cashflow.compare.map((c) => c.label)).toContain("Savings rate");
  });

  it("omits the period comparison when there is only one month", () => {
    const single = makeModel([makeTxn("2024-03-01", 500, "salary"), makeTxn("2024-03-04", -200, "food")]);
    const view = buildReportView(reportFor(single));

    expect(view.cashflow.months).toHaveLength(1);
    expect(view.cashflow.compare).toHaveLength(0);
  });

  it("reports the scenario baseline as a monthly mean the sliders can vary", () => {
    const view = buildReportView(reportFor(richModel()));

    expect(view.scenarioBase.months).toBe(6);
    expect(view.scenarioBase.income).toBeCloseTo(6000, 5);
    expect(view.scenarioBase.expenses).toBeGreaterThan(0);
  });

  it("survives an empty model without inventing anything", () => {
    const view = buildReportView(reportFor(makeModel([])));

    expect(view.findings).toHaveLength(0);
    expect(view.cashflow.months).toHaveLength(0);
    expect(view.spending.rows).toHaveLength(0);
    expect(view.unavailable.length).toBeGreaterThan(0);
    expect(view.band[3]?.value).toBe("—");
  });
});

describe("buildScenarioView", () => {
  it("formats each tracked metric by its unit and tones the change by direction", () => {
    const model = richModel();
    const baseline = runAnalyses(model);
    const result = simulate(model, { expensePct: 0.25 }, baseline);
    const view = buildScenarioView(result, model.currency);

    expect(view.rows).toHaveLength(result.deltas.length);
    const net = view.rows.find((r) => r.label === "Net cash flow");
    expect(net?.current).toContain("$");
    expect(net?.tone).toBe("critical"); // spending 25% more is worse
    const rate = view.rows.find((r) => r.label === "Savings rate");
    expect(rate?.current).toContain("%");
    expect(rate?.change).toContain("pp");
  });

  it('reports "No change" rather than a rounding artefact for an empty spec', () => {
    const model = richModel();
    const view = buildScenarioView(simulate(model, {}), model.currency);

    for (const row of view.rows) {
      expect(row.change).toBe("No change");
      expect(row.tone).toBe("muted");
    }
  });
});

describe("buildScenarioView with unavailable metrics (AV-17)", () => {
  it("shows a metric the engine could not compare as 'Not comparable', never as a figure", () => {
    const model = makeModel([makeTxn("2024-01-01", 3000, "salary"), makeTxn("2024-01-10", -900, "housing")]);
    const result = simulate(model, { incomePct: -1 });
    const view = buildScenarioView(result, model.currency);
    const score = view.rows.find((r) => r.label === "Health score");
    expect(score).toEqual({ label: "Health score", current: "—", scenario: "—", change: "Not comparable", tone: "muted" });
    expect(view.rows).toHaveLength(result.deltas.length + result.unavailable.length);
  });
});
