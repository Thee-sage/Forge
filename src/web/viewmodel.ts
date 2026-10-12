/**
 * Presentation adapter: `ForgeReport` -> `ReportView`.
 *
 * This is the only place that knows what the web interface looks like. It is a **pure
 * function of the report** (PROJECT_RULES §2) — no I/O, no globals, no fetching — so the
 * browser never has to compute a figure of its own: it receives finished strings and
 * renders them.
 *
 * It reads only the stable surface described in DATA_MODEL.md §10 (`model` typed fields,
 * `analyses` by module + metric key, `insights`, `normalization`). It never touches
 * `Transaction.raw` / `Holding.raw`, and it never invents a value the engine did not
 * produce: when a metric is absent the view says so rather than substituting a zero
 * (DATA_MODEL.md C4).
 */
import type { ForgeReport } from "../index.js";
import type { AssetClass, FinancialModel } from "../core/model.js";
import { findMetric, SEVERITY_RANK, type AnalysisResult, type Evidence, type Insight, type Severity } from "../core/result.js";
import { formatMoney, formatPercent, safeDiv } from "../core/money.js";
import { monthlyFlows, periodHalves, spendByCategory, type MonthlyFlow } from "../analysis/aggregates.js";
import type { NormalizationReport } from "../normalize/index.js";
import type { ScenarioResult } from "../scenario/simulate.js";

/* ------------------------------------------------------------------ view types */

/** How a figure should be tinted. The client maps these to palette tokens. */
export type Tone = "neutral" | "muted" | "positive" | "critical" | "high" | "medium" | "low" | "accent";

export interface Tile {
  label: string;
  /** Operator shown before the figure in the overview band ("−", "="). */
  op: string;
  value: string;
  sub: string;
  delta: string;
  deltaTone: Tone;
  /** Present only on the health tile, and only when a score exists. */
  bar?: { pct: string; tone: Tone };
}

export interface RelationRow {
  label: string;
  value: string;
  delta: string;
  tone: Tone;
  note: string;
}

export interface EvidenceRow {
  label: string;
  detail: string;
  module: string;
  value: string;
}

export interface FindingView {
  id: string;
  severity: Severity;
  severityLabel: string;
  tone: Tone;
  headline: string;
  explanation: string;
  confidence: string;
  confidenceLabel: string;
  confidenceTicks: number;
  drivers: string[];
  basis: string[];
  evidence: EvidenceRow[];
}

export interface SeverityBucket {
  key: Severity;
  label: string;
  tone: Tone;
  count: number;
  note: string;
}

export interface MonthBar {
  month: string;
  label: string;
  inflow: string;
  outflow: string;
  net: string;
  /** 0..1 of the tallest bar in the series. */
  inflowScale: number;
  outflowScale: number;
  rate: string;
  tone: Tone;
}

export interface CompareRow {
  label: string;
  earlier: string;
  recent: string;
  change: string;
  tone: Tone;
}

export interface CategoryRow {
  label: string;
  amount: string;
  share: string;
  /** 0..1 of the largest category. */
  scale: number;
  flagged: boolean;
}

export interface AnomalyRow {
  label: string;
  amount: string;
  note: string;
  tag: string;
  tone: Tone;
}

export interface AllocationRow {
  label: string;
  pct: string;
  value: string;
  scale: number;
  isCash: boolean;
}

export interface ConcentrationRow {
  label: string;
  value: string;
  note: string;
  tone: Tone;
}

export interface HoldingRow {
  rank: string;
  label: string;
  cls: string;
  value: string;
  pct: string;
  scale: number;
  tone: Tone;
}

export interface SourceRow {
  name: string;
  kind: string;
  rows: string;
  parsed: string;
  skipped: string;
  range: string;
}

export interface WarningRow {
  level: string;
  tone: Tone;
  text: string;
}

export interface Fact {
  label: string;
  value: string;
  tone: Tone;
}

/** An analysis that could not run, with the engine's reason for it. */
export interface UnavailableView {
  tag: string;
  title: string;
  body: string;
}

export interface ReportView {
  meta: {
    currency: string;
    rangeLabel: string;
    months: number;
    transactions: number;
    holdings: number;
    sources: string[];
    contextMeta: string;
  };
  band: Tile[];
  relations: RelationRow[];
  findings: FindingView[];
  severityLedger: SeverityBucket[];
  cashflow: { months: MonthBar[]; compare: CompareRow[]; note: string };
  spending: { total: string; rows: CategoryRow[]; anomalies: AnomalyRow[]; note: string };
  portfolio: {
    total: string;
    invested: string;
    allocation: AllocationRow[];
    concentration: ConcentrationRow[];
    concentrationFlagged: boolean;
    holdings: HoldingRow[];
  };
  data: {
    facts: Fact[];
    sources: SourceRow[];
    warnings: WarningRow[];
    summary: string;
  };
  /** Reported baseline for the scenario sliders, in whole currency units per month. */
  scenarioBase: { income: number; expenses: number; months: number };
  unavailable: UnavailableView[];
}

/* ------------------------------------------------------------------ helpers */

const SEVERITY_VIEW: Record<Severity, { label: string; tone: Tone; note: string }> = {
  critical: { label: "Critical", tone: "critical", note: "Breaches a hard threshold" },
  warning: { label: "Warning", tone: "high", note: "Material to a conclusion" },
  notice: { label: "Notice", tone: "medium", note: "Directional, monitor" },
  info: { label: "Info", tone: "low", note: "Recorded for traceability" },
};

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-01" -> "Jan 26". Purely a label; no date arithmetic. */
function monthLabel(key: string): string {
  const [y, m] = key.split("-");
  const idx = Number(m) - 1;
  return `${MONTH_NAMES[idx] ?? m} ${(y ?? "").slice(2)}`;
}

/** "2026-01-31" -> "31 Jan 2026". */
function dateLabel(iso: string): string {
  const [y, m, d] = iso.split("-");
  const idx = Number(m) - 1;
  return `${d} ${MONTH_NAMES[idx] ?? m} ${y}`;
}

function signedPercent(ratio: number, eps = 0.001): string {
  if (Math.abs(ratio) < eps) return "Stable";
  return `${ratio > 0 ? "+" : "−"}${formatPercent(Math.abs(ratio))}`;
}

function signedPoints(delta: number, eps = 0.0005): string {
  if (Math.abs(delta) < eps) return "Stable";
  return `${delta > 0 ? "+" : "−"}${(Math.abs(delta) * 100).toFixed(1)} pp`;
}

/** Tone for a change, given whether "up" is the good direction. */
function changeTone(delta: number, upIsGood: boolean, eps = 0.001): Tone {
  if (Math.abs(delta) < eps) return "muted";
  return delta > 0 === upIsGood ? "positive" : "critical";
}

function confidenceLabel(c: number): string {
  return c >= 0.85 ? "High" : c >= 0.7 ? "Moderate" : "Low";
}

function evidenceRows(evidence: Evidence[]): EvidenceRow[] {
  return evidence.map((e) => ({
    label: e.label,
    detail: e.detail,
    module: e.module ?? "—",
    value: e.value === undefined ? "—" : formatEvidenceValue(e.value),
  }));
}

/**
 * Evidence carries a bare `value` whose unit is not declared in the contract, so it is
 * shown as a plain magnitude — never re-formatted as money it might not be. Values that
 * are clearly ratios (|v| <= 1) render as percentages; everything else keeps 2 dp.
 */
function formatEvidenceValue(value: number): string {
  if (Math.abs(value) <= 1) return value.toFixed(3);
  return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function moduleOf(analyses: AnalysisResult[], name: string): AnalysisResult | undefined {
  return analyses.find((a) => a.module === name);
}

const ASSET_CLASS_LABEL: Record<AssetClass, string> = {
  equity: "Equity",
  fixed_income: "Fixed income",
  cash: "Cash",
  real_estate: "Real estate",
  commodity: "Commodity",
  crypto: "Crypto",
  alternative: "Alternative",
  unknown: "Unclassified",
};

function titleCase(s: string): string {
  return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1);
}

/* ------------------------------------------------------------------ builder */

/** Build the complete web view of a report. Pure. */
export function buildReportView(report: ForgeReport): ReportView {
  const { model, analyses, insights, normalization } = report;
  const cur = model.currency;
  const flows = monthlyFlows(model.transactions);

  return {
    meta: buildMeta(model),
    band: buildBand(model, analyses, flows),
    relations: buildRelations(analyses, flows, cur),
    findings: buildFindings(insights),
    severityLedger: buildLedger(insights),
    cashflow: buildCashflow(model, analyses, flows),
    spending: buildSpending(model, analyses),
    portfolio: buildPortfolio(model, analyses),
    data: buildData(model, normalization),
    scenarioBase: buildScenarioBase(analyses, model),
    unavailable: buildUnavailable(model, analyses),
  };
}

function buildMeta(model: FinancialModel): ReportView["meta"] {
  const range = `${dateLabel(model.period.start)} – ${dateLabel(model.period.end)}`;
  return {
    currency: model.currency,
    rangeLabel: range,
    months: model.period.months,
    transactions: model.meta.rowCounts.transactions,
    holdings: model.meta.rowCounts.holdings,
    sources: model.meta.sources,
    contextMeta: `${range}  ·  ${model.currency}  ·  ${model.meta.rowCounts.transactions.toLocaleString("en-US")} txn`,
  };
}

function buildBand(model: FinancialModel, analyses: AnalysisResult[], flows: MonthlyFlow[]): Tile[] {
  const cur = model.currency;
  const inflow = findMetric(analyses, "cashflow", "inflow") ?? 0;
  const outflow = findMetric(analyses, "cashflow", "outflow") ?? 0;
  const net = findMetric(analyses, "cashflow", "net") ?? 0;
  const savingsRate = findMetric(analyses, "cashflow", "savingsRate") ?? 0;
  const halves = periodHalves(flows);

  const inflowDelta = halves ? safeDiv(halves.recent.inflow - halves.earlier.inflow, halves.earlier.inflow) : 0;
  const outflowDelta = halves ? safeDiv(halves.recent.outflow - halves.earlier.outflow, halves.earlier.outflow) : 0;
  const netDelta = halves ? safeDiv(halves.recent.net - halves.earlier.net, Math.abs(halves.earlier.net)) : 0;

  const tiles: Tile[] = [
    {
      label: "Inflow",
      op: "",
      value: formatMoney(inflow, cur),
      sub: `over ${model.period.months} month(s)`,
      delta: halves ? signedPercent(inflowDelta) : "Single window",
      deltaTone: halves ? changeTone(inflowDelta, true) : "muted",
    },
    {
      label: "Outflow",
      op: "−",
      value: formatMoney(outflow, cur),
      sub: "vs earlier window",
      delta: halves ? signedPercent(outflowDelta) : "Single window",
      deltaTone: halves ? changeTone(outflowDelta, false) : "muted",
    },
    {
      label: "Net cash flow",
      op: "=",
      value: formatMoney(net, cur),
      sub: `savings rate ${formatPercent(savingsRate)}`,
      delta: halves ? signedPercent(netDelta) : "Single window",
      deltaTone: halves ? changeTone(netDelta, true) : "muted",
    },
  ];

  // C4: a health score is not always emitted. Say so rather than showing a zero.
  const score = findMetric(analyses, "health", "score");
  const assessed = findMetric(analyses, "health", "assessedDimensions") ?? 0;
  if (score === undefined) {
    tiles.push({
      label: "Health score",
      op: "",
      value: "—",
      sub: "not assessed",
      delta: "No cash-flow data",
      deltaTone: "muted",
    });
  } else {
    tiles.push({
      label: "Health score",
      op: "",
      value: String(Math.round(score)),
      sub: `/ 100 · ${gradeLabel(score)} · ${assessed} dimension(s)`,
      delta: gradeLabel(score),
      deltaTone: scoreTone(score),
      bar: { pct: `${Math.max(0, Math.min(100, score))}%`, tone: scoreTone(score) },
    });
  }
  return tiles;
}

function gradeLabel(score: number): string {
  if (score >= 80) return "strong";
  if (score >= 65) return "sound";
  if (score >= 50) return "moderate";
  if (score >= 35) return "strained";
  return "weak";
}

function scoreTone(score: number): Tone {
  if (score >= 65) return "positive";
  if (score >= 50) return "medium";
  return "critical";
}

function buildRelations(analyses: AnalysisResult[], flows: MonthlyFlow[], cur: string): RelationRow[] {
  const rows: RelationRow[] = [];

  const runway = findMetric(analyses, "health", "runwayMonths");
  if (runway === undefined) {
    rows.push({
      label: "Liquidity / runway",
      value: "—",
      delta: "not assessed",
      tone: "muted",
      note: "Runway needs both a cash holding and monthly outflow; one of them is absent from this dataset.",
    });
  } else {
    rows.push({
      label: "Liquidity / runway",
      value: `${runway.toFixed(1)} mo`,
      delta: runway < 3 ? "below 3-month floor" : "above 3-month floor",
      tone: runway < 3 ? "critical" : "positive",
      note: `Cash holdings measured against mean monthly outflow across ${flows.length} month(s).`,
    });
  }

  const savingsRate = findMetric(analyses, "cashflow", "savingsRate");
  const halves = periodHalves(flows);
  if (savingsRate !== undefined) {
    const delta = halves ? halves.recent.savingsRate - halves.earlier.savingsRate : 0;
    rows.push({
      label: "Savings rate",
      value: formatPercent(savingsRate),
      delta: halves ? signedPoints(delta) : "single window",
      tone: halves ? changeTone(delta, true, 0.0005) : "muted",
      note: halves
        ? `Recent half ${formatPercent(halves.recent.savingsRate)} against earlier half ${formatPercent(halves.earlier.savingsRate)}.`
        : "Only one window of data — no period-over-period comparison is available.",
    });
  }

  const trend = findMetric(analyses, "cashflow", "trendSlope");
  if (trend !== undefined) {
    rows.push({
      label: "Net cash-flow trend",
      value: signedPercent(trend, 0.005),
      delta: trend < 0 ? "declining" : trend > 0 ? "improving" : "flat",
      tone: changeTone(trend, true, 0.005),
      note: `Mean monthly net in the recent half against the earlier half (${formatMoney(findMetric(analyses, "cashflow", "avgMonthlyNet") ?? 0, cur)} average).`,
    });
  }

  return rows;
}

function buildFindings(insights: Insight[]): FindingView[] {
  return insights.map((i) => {
    const sv = SEVERITY_VIEW[i.severity];
    return {
      id: i.ruleId,
      severity: i.severity,
      severityLabel: sv.label,
      tone: sv.tone,
      headline: i.headline,
      explanation: i.explanation,
      confidence: i.confidence.toFixed(2),
      confidenceLabel: confidenceLabel(i.confidence),
      confidenceTicks: Math.round(i.confidence * 10),
      drivers: i.drivers,
      basis: i.basis,
      evidence: evidenceRows(i.evidence),
    };
  });
}

function buildLedger(insights: Insight[]): SeverityBucket[] {
  // Most severe first, matching the order insights themselves are sorted in.
  const order: Severity[] = (["critical", "warning", "notice", "info"] as Severity[]).sort(
    (a, b) => SEVERITY_RANK[b] - SEVERITY_RANK[a],
  );
  return order.map((key) => {
      const sv = SEVERITY_VIEW[key];
      const count = insights.filter((i) => i.severity === key).length;
      return {
        key,
        label: sv.label,
        tone: sv.tone,
        count,
        note: count === 0 ? "None flagged" : sv.note,
    };
  });
}

function buildCashflow(
  model: FinancialModel,
  analyses: AnalysisResult[],
  flows: MonthlyFlow[],
): ReportView["cashflow"] {
  const cur = model.currency;
  const peak = Math.max(1, ...flows.map((f) => Math.max(f.inflow, f.outflow)));

  const months: MonthBar[] = flows.map((f) => ({
    month: f.month,
    label: monthLabel(f.month),
    inflow: formatMoney(f.inflow, cur),
    outflow: formatMoney(f.outflow, cur),
    net: formatMoney(f.net, cur),
    inflowScale: f.inflow / peak,
    outflowScale: f.outflow / peak,
    rate: f.inflow > 0 ? formatPercent(safeDiv(f.net, f.inflow)) : "—",
    tone: f.net < 0 ? "critical" : f.net < safeDiv(f.inflow, 10) ? "high" : "neutral",
  }));

  const halves = periodHalves(flows);
  const compare: CompareRow[] = [];
  if (halves) {
    const { earlier, recent } = halves;
    const pct = (a: number, b: number) => safeDiv(b - a, Math.abs(a));
    compare.push(
      {
        label: "Inflow",
        earlier: formatMoney(earlier.inflow, cur),
        recent: formatMoney(recent.inflow, cur),
        change: signedPercent(pct(earlier.inflow, recent.inflow)),
        tone: changeTone(pct(earlier.inflow, recent.inflow), true),
      },
      {
        label: "Outflow",
        earlier: formatMoney(earlier.outflow, cur),
        recent: formatMoney(recent.outflow, cur),
        change: signedPercent(pct(earlier.outflow, recent.outflow)),
        tone: changeTone(pct(earlier.outflow, recent.outflow), false),
      },
      {
        label: "Net cash flow",
        earlier: formatMoney(earlier.net, cur),
        recent: formatMoney(recent.net, cur),
        change: signedPercent(pct(earlier.net, recent.net)),
        tone: changeTone(pct(earlier.net, recent.net), true),
      },
      {
        label: "Savings rate",
        earlier: formatPercent(earlier.savingsRate),
        recent: formatPercent(recent.savingsRate),
        change: signedPoints(recent.savingsRate - earlier.savingsRate),
        tone: changeTone(recent.savingsRate - earlier.savingsRate, true, 0.0005),
      },
      {
        label: "Lowest month",
        earlier: formatMoney(earlier.lowestNet, cur),
        recent: formatMoney(recent.lowestNet, cur),
        change: signedPercent(pct(earlier.lowestNet, recent.lowestNet)),
        tone: changeTone(pct(earlier.lowestNet, recent.lowestNet), true),
      },
    );
  }

  const cf = moduleOf(analyses, "cashflow");
  const note =
    cf && cf.findings.length > 0
      ? cf.findings.map((f) => f.message).join(" ")
      : `${flows.length} month(s) of transactions in ${cur}; no cash-flow finding was raised.`;

  return { months, compare, note };
}

function buildSpending(model: FinancialModel, analyses: AnalysisResult[]): ReportView["spending"] {
  const cur = model.currency;
  const outflow = findMetric(analyses, "expenditure", "totalOutflow") ?? 0;
  const byCategory = spendByCategory(model.transactions);
  const largest = byCategory[0]?.amount ?? 1;

  const flaggedCategories = new Set<string>();
  const trend = moduleOf(analyses, "trend");
  for (const e of trend?.evidence ?? []) flaggedCategories.add(e.label.toLowerCase());

  const rows: CategoryRow[] = byCategory.slice(0, 12).map((c) => ({
    label: titleCase(c.category),
    amount: formatMoney(c.amount, cur),
    share: formatPercent(safeDiv(c.amount, outflow)),
    scale: safeDiv(c.amount, largest),
    flagged: flaggedCategories.has(c.category.toLowerCase()) || c.category === "uncategorized",
  }));

  const anomaly = moduleOf(analyses, "anomaly");
  const anomalies: AnomalyRow[] = (anomaly?.evidence ?? []).map((e) => ({
    label: e.label,
    amount: e.value === undefined ? "—" : formatMoney(e.value, cur),
    note: e.detail,
    tag: "Outlier",
    tone: "medium",
  }));
  for (const e of trend?.evidence ?? []) {
    anomalies.push({
      label: titleCase(e.label),
      amount: e.value === undefined ? "—" : formatMoney(e.value, cur),
      note: e.detail,
      tag: "Category shift",
      tone: "high",
    });
  }

  const exp = moduleOf(analyses, "expenditure");
  const note =
    exp && exp.findings.length > 0
      ? exp.findings.map((f) => f.message).join(" ")
      : `${byCategory.length} distinct categories account for ${formatMoney(outflow, cur)} of outflow. No expenditure finding was raised.`;

  return { total: formatMoney(outflow, cur), rows, anomalies, note };
}

function buildPortfolio(model: FinancialModel, analyses: AnalysisResult[]): ReportView["portfolio"] {
  const cur = model.currency;
  const total = findMetric(analyses, "allocation", "portfolioValue") ?? 0;
  const allocationModule = moduleOf(analyses, "allocation");

  const allocation: AllocationRow[] = (allocationModule?.evidence ?? []).map((e) => {
    const weight = safeDiv(e.value ?? 0, total);
    return {
      label: ASSET_CLASS_LABEL[e.label as AssetClass] ?? titleCase(e.label),
      pct: formatPercent(weight),
      value: formatMoney(e.value ?? 0, cur),
      scale: weight,
      isCash: e.label === "cash",
    };
  });

  const cashWeight = findMetric(analyses, "allocation", "cashWeight") ?? 0;
  const invested = total * (1 - cashWeight);

  const riskHhi = findMetric(analyses, "concentration", "riskHhi");
  const concentrationFlagged = riskHhi !== undefined && riskHhi > 0.15;
  const concentration: ConcentrationRow[] = [];
  if (riskHhi !== undefined) {
    concentration.push(
      {
        label: "Market concentration (HHI, ex-cash)",
        value: riskHhi.toFixed(3),
        note: concentrationFlagged ? "Above the 0.15 threshold" : "Within the 0.15 threshold",
        tone: concentrationFlagged ? "high" : "positive",
      },
      {
        label: "Largest investment weight",
        value: formatPercent(findMetric(analyses, "concentration", "topNonCashWeight") ?? 0),
        note: "Cash excluded from the measure (C5)",
        tone: "neutral",
      },
      {
        label: "Top 3 weight",
        value: formatPercent(findMetric(analyses, "concentration", "top3Weight") ?? 0),
        note: `Of ${formatMoney(invested, cur)} invested`,
        tone: "neutral",
      },
      {
        label: "Effective positions",
        value: (findMetric(analyses, "concentration", "effectivePositions") ?? 0).toFixed(1),
        note: `${findMetric(analyses, "concentration", "positions") ?? 0} position(s) held`,
        tone: "neutral",
      },
      {
        label: "Cash allocation",
        value: formatPercent(cashWeight),
        note: "A return drag, not a concentration risk",
        tone: "neutral",
      },
    );
  }

  const sorted = [...model.holdings].sort((a, b) => b.value - a.value);
  const topValue = sorted[0]?.value ?? 1;
  const holdings: HoldingRow[] = sorted.map((h, i) => {
    const weight = safeDiv(h.value, total);
    return {
      rank: String(i + 1).padStart(2, "0"),
      label: h.symbol === h.name ? h.name : `${h.symbol} · ${h.name}`,
      cls: ASSET_CLASS_LABEL[h.assetClass],
      value: formatMoney(h.value, cur),
      pct: formatPercent(weight),
      scale: safeDiv(h.value, topValue),
      tone: weight > 0.15 ? "high" : "neutral",
    };
  });

  return {
    total: formatMoney(total, cur),
    invested: formatMoney(invested, cur),
    allocation,
    concentration,
    concentrationFlagged,
    holdings,
  };
}

function buildData(model: FinancialModel, normalization: NormalizationReport): ReportView["data"] {
  const perSource = new Map<string, { rows: number; parsed: number; skipped: number; dates: string[] }>();
  const bucket = (src: string) => {
    let b = perSource.get(src);
    if (!b) {
      b = { rows: 0, parsed: 0, skipped: 0, dates: [] };
      perSource.set(src, b);
    }
    return b;
  };
  for (const s of model.meta.sources) bucket(s);
  for (const t of model.transactions) {
    const b = bucket(t.source);
    b.parsed += 1;
    b.dates.push(t.date);
  }
  for (const h of model.holdings) bucket(h.source).parsed += 1;
  for (const s of normalization.skippedRows) bucket(s.source).skipped += 1;

  const sources: SourceRow[] = [...perSource.entries()].map(([path, b]) => {
    const dates = b.dates.slice().sort();
    const first = dates[0];
    const last = dates[dates.length - 1];
    return {
      name: path.split(/[\\/]/).pop() ?? path,
      kind: (path.split(".").pop() ?? "").toUpperCase(),
      rows: String(b.parsed + b.skipped),
      parsed: String(b.parsed),
      skipped: String(b.skipped),
      range: first && last ? `${dateLabel(first)} – ${dateLabel(last)}` : "—",
    };
  });

  const warnings: WarningRow[] = normalization.warnings.map((text) => ({
    level: "Warning",
    tone: "medium",
    text,
  }));
  // Every dropped row is individually explainable (C7) — group them by reason.
  const byReason = new Map<string, number>();
  for (const s of normalization.skippedRows) {
    byReason.set(s.reason, (byReason.get(s.reason) ?? 0) + 1);
  }
  for (const [reason, count] of byReason) {
    warnings.push({
      level: "Skipped",
      tone: "high",
      text: `${count} row(s) dropped: ${reason}. Nothing was inferred to replace them.`,
    });
  }

  const facts: Fact[] = [
    { label: "Transactions", value: model.meta.rowCounts.transactions.toLocaleString("en-US"), tone: "neutral" },
    { label: "Holdings", value: String(model.meta.rowCounts.holdings), tone: "neutral" },
    { label: "Date range", value: `${dateLabel(model.period.start)} – ${dateLabel(model.period.end)}`, tone: "neutral" },
    { label: "Currency", value: model.currency || "—", tone: "positive" },
    {
      label: "Skipped rows",
      value: String(normalization.rowsSkipped),
      tone: normalization.rowsSkipped > 0 ? "high" : "muted",
    },
    {
      label: "Warnings",
      value: String(normalization.warnings.length),
      tone: normalization.warnings.length > 0 ? "medium" : "muted",
    },
  ];

  const summary =
    `Every figure in this report derives from the ${model.meta.rowCounts.transactions.toLocaleString("en-US")} transaction(s) ` +
    `and ${model.meta.rowCounts.holdings} holding(s) listed above, in ${model.currency || "no declared currency"}, ` +
    `between ${dateLabel(model.period.start)} and ${dateLabel(model.period.end)}. ` +
    (normalization.rowsSkipped > 0
      ? `${normalization.rowsSkipped} row(s) were excluded and are named in the warnings; nothing was inferred to replace them.`
      : "No rows were excluded.");

  return { facts, sources, warnings, summary };
}

function buildScenarioBase(analyses: AnalysisResult[], model: FinancialModel): ReportView["scenarioBase"] {
  const months = Math.max(1, model.period.months);
  return {
    income: (findMetric(analyses, "cashflow", "inflow") ?? 0) / months,
    expenses: (findMetric(analyses, "cashflow", "outflow") ?? 0) / months,
    months,
  };
}

/**
 * What the engine could *not* assess, and why. Forge never substitutes a zero for an
 * unknown, so the interface states the gap explicitly (PROJECT_RULES §5).
 */
function buildUnavailable(model: FinancialModel, analyses: AnalysisResult[]): UnavailableView[] {
  const out: UnavailableView[] = [];

  if (model.holdings.length === 0) {
    out.push({
      tag: "Portfolio",
      title: "No holdings detected in this dataset.",
      body: "Asset allocation and concentration analysis are unavailable. Add a holdings table to enable them.",
    });
  }
  if (model.transactions.length === 0) {
    out.push({
      tag: "Cash flow",
      title: "No transactions detected in this dataset.",
      body: "Cash flow, expenditure, trend and anomaly analysis all need dated money movements.",
    });
  }
  if (findMetric(analyses, "health", "score") === undefined) {
    const health = moduleOf(analyses, "health");
    out.push({
      tag: "Health score",
      title: "Financial health could not be scored.",
      body:
        health?.findings[0]?.message ??
        "A health score requires cash-flow data; the engine declined to emit one rather than fabricate it.",
    });
  }
  if ((findMetric(analyses, "anomaly", "anomalies") ?? 0) === 0 && model.transactions.length > 0) {
    out.push({
      tag: "Anomalies",
      title: "No transactions met the outlier threshold.",
      body: "Forge examined the outflow series and found none beyond its robust (median/MAD) threshold. This is a result, not an absence of analysis.",
    });
  }
  return out;
}

/* ------------------------------------------------------------------ scenario view */

export interface ScenarioRow {
  label: string;
  current: string;
  scenario: string;
  change: string;
  tone: Tone;
}

export interface ScenarioView {
  description: string;
  explanation: string;
  rows: ScenarioRow[];
  verdictTone: Tone;
}

/** Format a `ScenarioResult` for the scenarios screen. Pure. */
export function buildScenarioView(result: ScenarioResult, currency: string): ScenarioView {
  const rows: ScenarioRow[] = result.deltas.map((d) => {
    const fmt = (v: number) => formatValue(v, d.unit, currency);
    // For every tracked metric, higher is better (score, net, savings rate, runway).
    const eps = d.unit === "percent" ? 0.0005 : d.unit === "count" ? 0.005 : 0.5;
    return {
      label: d.label,
      current: fmt(d.baseline),
      scenario: fmt(d.scenario),
      change:
        Math.abs(d.delta) < eps
          ? "No change"
          : `${d.delta > 0 ? "+" : "−"}${formatValue(Math.abs(d.delta), d.unit, currency, true)}`,
      tone: Math.abs(d.delta) < eps ? "muted" : d.delta > 0 ? "positive" : "critical",
    };
  });

  // A metric the engine could not compute is shown as unavailable, never as a figure.
  for (const u of result.unavailable) {
    rows.push({ label: u.label, current: "—", scenario: "—", change: "Not comparable", tone: "muted" });
  }

  const runway = result.deltas.find((d) => d.key === "health.runwayMonths");
  const net = result.deltas.find((d) => d.key === "cashflow.net");
  const verdictTone: Tone =
    net && net.scenario < 0 ? "critical" : runway && runway.scenario < 3 ? "high" : "positive";

  return {
    description: result.description,
    explanation: result.explanation,
    rows,
    verdictTone,
  };
}

function formatValue(value: number, unit: string | undefined, currency: string, isDelta = false): string {
  switch (unit) {
    case "currency":
      return formatMoney(value, currency);
    case "percent":
      return isDelta ? `${(value * 100).toFixed(1)} pp` : formatPercent(value);
    case "count":
      return `${value.toFixed(2)} mo`;
    case "score":
      return isDelta ? `${Math.round(value)} pt` : `${Math.round(value)} / 100`;
    default:
      return value.toFixed(2);
  }
}
