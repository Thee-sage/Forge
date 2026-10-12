import { runAnalyses, simulate, type AnalysisResult } from "../../src/index.js";
import type { Execution } from "./execute.js";
import { metaOf } from "./numeric.js";
import { mkCheck, type Check } from "./records.js";

/**
 * Properties that must hold for EVERY report, whatever the input. A violation is always
 * "critical": these are the guarantees (docs/DATA_MODEL.md section 9, PROJECT_RULES section 10)
 * that a high average score must never conceal.
 */
const val = (rs: AnalysisResult[], m: string, k: string): number | undefined => rs.find((r) => r.module === m)?.metrics.find((x) => x.key === k)?.value;

function allNumbers(e: Execution): { where: string; v: number }[] {
  const out: { where: string; v: number }[] = [];
  const r = e.report!;
  for (const a of r.analyses) {
    a.metrics.forEach((m) => out.push({ where: `${a.module}.${m.key}`, v: m.value }));
    [...a.evidence, ...a.findings.flatMap((f) => f.evidence)].forEach((x) => x.value !== undefined && out.push({ where: `${a.module} evidence ${x.label}`, v: x.value }));
  }
  r.insights.forEach((i) => i.evidence.forEach((x) => x.value !== undefined && out.push({ where: `insight ${i.ruleId} evidence ${x.label}`, v: x.value })));
  r.model.transactions.forEach((t) => out.push({ where: `transaction ${t.id}`, v: t.amount }));
  r.model.holdings.forEach((h) => out.push({ where: `holding ${h.id}`, v: h.value }));
  return out;
}

export function invariantChecks(e: Execution): Check[] {
  const r = e.report;
  if (!r) return [];
  const meta = metaOf(e);
  const out: Check[] = [];
  const inv = (name: string, pass: boolean, detail?: string): void => void out.push(mkCheck(meta, "invariant", name, pass ? "pass" : "fail", "critical", { detail }));

  const bad = allNumbers(e).filter((x) => !Number.isFinite(x.v));
  inv("finite-values", bad.length === 0, bad.length ? `non-finite: ${bad.slice(0, 3).map((b) => b.where).join(", ")}` : undefined);
  inv("amount-sign-discipline", r.model.transactions.every((t) => t.amount >= 0) && r.model.holdings.every((h) => h.value > 0), "transaction amount < 0 or holding value <= 0");
  inv("single-currency", r.model.currencies.length <= 1 && [...r.model.transactions, ...r.model.holdings].every((x) => x.currency === r.model.currencies[0]));

  // C6 / D9: every insight is traceable.
  const ruleIds = r.insights.map((i) => i.ruleId);
  const wellFormed = r.insights.every((i) => i.evidence.length > 0 && i.basis.length > 0 && i.confidence >= 0 && i.confidence <= 1 && i.evidence.every((ev) => ev.module !== undefined && i.basis.includes(ev.module)));
  inv("insights-traceable", wellFormed && new Set(ruleIds).size === ruleIds.length, "insight lacks evidence/basis, has evidence outside its basis, or a duplicate ruleId");

  // C7: no silent loss. parsed + skipped = rows read.
  const skippedIn = (name: string | undefined): number => r.normalization.skippedRows.filter((s) => s.table === name).length;
  if (e.dataRows.transactions !== undefined) {
    const got = r.normalization.transactionsParsed + skippedIn(e.txnFile);
    inv("row-conservation:transactions", got === e.dataRows.transactions, `parsed+skipped=${got}, rows read=${e.dataRows.transactions}`);
  }
  if (e.dataRows.holdings !== undefined) {
    const got = r.normalization.holdingsParsed + skippedIn(e.holdFile);
    inv("row-conservation:holdings", got === e.dataRows.holdings, `parsed+skipped=${got}, rows read=${e.dataRows.holdings}`);
  }

  // Mathematical bounds.
  const a = r.analyses;
  const score = val(a, "health", "score");
  inv("health-score-range", score === undefined || (Number.isInteger(score) && score >= 0 && score <= 100), `score=${score}`);
  const n = r.model.holdings.length;
  const hhi = val(a, "concentration", "hhi");
  if (n > 0 && hhi !== undefined) {
    inv("hhi-bounds", hhi >= 1 / n - 1e-12 && hhi <= 1 + 1e-12, `hhi=${hhi}, n=${n}`);
    const eff = val(a, "concentration", "effectivePositions");
    inv("effective-positions-formula", eff !== undefined && Math.abs(eff - 1 / hhi) <= 1e-9 * (1 / hhi) && eff >= 1 - 1e-9 && eff <= n + 1e-9, `eff=${eff}, 1/hhi=${1 / hhi}`);
    const top = val(a, "concentration", "topWeight") ?? 0;
    const top3 = val(a, "concentration", "top3Weight") ?? 0;
    inv("weights-ordering", top <= top3 + 1e-12 && top3 <= 1 + 1e-12 && top >= 1 / n - 1e-12, `top=${top}, top3=${top3}`);
    const nonCash = r.model.holdings.filter((h) => h.assetClass !== "cash").length;
    const risk = val(a, "concentration", "riskHhi");
    if (nonCash > 0 && risk !== undefined) inv("risk-hhi-bounds", risk >= 1 / nonCash - 1e-12 && risk <= 1 + 1e-12, `riskHhi=${risk}, nonCash=${nonCash}`);
    const weights = a.find((x) => x.module === "allocation")?.metrics.filter((m) => m.key.startsWith("weight_")).map((m) => m.value) ?? [];
    inv("class-weights-sum-to-one", weights.length > 0 && Math.abs(weights.reduce((x, y) => x + y, 0) - 1) <= 1e-9, `sum=${weights.reduce((x, y) => x + y, 0)}`);
  }
  const sr = val(a, "cashflow", "savingsRate");
  inv("savings-rate-bound", sr === undefined || sr <= 1 + 1e-12, `savingsRate=${sr}`);
  const inflow = val(a, "cashflow", "inflow") ?? 0;
  const outflow = val(a, "cashflow", "outflow") ?? 0;
  const net = val(a, "cashflow", "net") ?? 0;
  inv("net-equals-inflow-minus-outflow", Math.abs(net - (inflow - outflow)) <= 1e-6 + 1e-12 * Math.abs(inflow), `net=${net}, in-out=${inflow - outflow}`);
  const flowsTotal = r.model.transactions.reduce((x, t) => x + (t.direction === "inflow" ? t.amount : -t.amount), 0);
  inv("net-equals-sum-of-signed-transactions", Math.abs(net - flowsTotal) <= 1e-6 + 1e-12 * Math.abs(inflow), `net=${net}, sum=${flowsTotal}`);

  // Scenario properties (only meaningful on a model Forge accepted).
  const before = JSON.stringify(r.model);
  let baselineEqual = false;
  let noMutation = false;
  try {
    const zero = simulate(r.model, {}, r.analyses);
    baselineEqual = zero.deltas.every((d) => d.delta === 0) && JSON.stringify(zero.scenarioResults.map((x) => x.metrics)) === JSON.stringify(r.analyses.map((x) => x.metrics));
    simulate(r.model, { incomePct: 0.1, expensePct: 0.1, recurringExpense: { amount: 10, category: "x" }, oneOffExpense: { amount: 10, category: "x" } });
    noMutation = JSON.stringify(r.model) === before;
  } catch {
    // leave both false
  }
  inv("baseline-scenario-equals-baseline", baselineEqual, "simulate(model, {}) differs from the unmodified analysis");
  inv("scenario-does-not-mutate-model", noMutation, "the model changed after simulate()");

  // Order invariance: equivalent inputs (same rows, different order) give equivalent results.
  try {
    const flipped = { ...r.model, transactions: [...r.model.transactions].reverse(), holdings: [...r.model.holdings].reverse() };
    const again = runAnalyses(flipped);
    let diff = "";
    for (const m of r.analyses) {
      const other = again.find((x) => x.module === m.module);
      for (const metric of m.metrics) {
        if (metric.key.startsWith("expenditure.top") || metric.key.startsWith("top")) continue;
        const o = other?.metrics.find((x) => x.key === metric.key)?.value;
        if (o === undefined || Math.abs(o - metric.value) > 1e-6 + 1e-9 * Math.abs(metric.value)) diff = `${m.module}.${metric.key}: ${metric.value} vs ${o}`;
      }
    }
    inv("order-invariance", diff === "", diff);
  } catch (err) {
    inv("order-invariance", false, String(err));
  }
  return out;
}
