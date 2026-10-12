import { TARGET_RATE } from "./version.js";
import { bootstrapF1, prf, wilson, type Counts, type Interval } from "./stats.js";
import { FINDING_TYPES } from "./runner/insight.js";
import type { Check } from "./runner/records.js";

export interface Rate { n: number; pass: number; fail: number; na: number; rate: number; ci: Interval }

export function rateOf(checks: Check[]): Rate {
  const pass = checks.filter((c) => c.status === "pass").length;
  const fail = checks.filter((c) => c.status === "fail").length;
  const na = checks.filter((c) => c.status === "na").length;
  const n = pass + fail;
  const ci = wilson(pass, n);
  return { n, pass, fail, na, rate: n === 0 ? NaN : pass / n, ci };
}

const group = <T,>(xs: T[], key: (x: T) => string): Map<string, T[]> => {
  const m = new Map<string, T[]>();
  for (const x of xs) {
    const k = key(x);
    (m.get(k) ?? m.set(k, []).get(k)!).push(x);
  }
  return m;
};

const casesPassing = (checks: Check[]): Rate => {
  const byCase = [...group(checks, (c) => c.caseId).values()];
  const pass = byCase.filter((cs) => cs.every((c) => c.status !== "fail")).length;
  const n = byCase.length;
  return { n, pass, fail: n - pass, na: 0, rate: n === 0 ? NaN : pass / n, ci: wilson(pass, n) };
};

export interface ErrorMagnitude { comparisons: number; maxAbsErrorAmongPassing: number; failing: number; medianRelErrorAmongFailing: number | null; maxAbsErrorAmongFailing: number | null }

function magnitude(checks: Check[]): ErrorMagnitude {
  const num = checks.filter((c) => c.category === "numeric" && c.absError !== undefined);
  const passing = num.filter((c) => c.status === "pass");
  const failing = num.filter((c) => c.status === "fail");
  const rels = failing.map((c) => c.relError!).sort((a, b) => a - b);
  return {
    comparisons: num.length,
    maxAbsErrorAmongPassing: passing.reduce((m, c) => Math.max(m, c.absError!), 0),
    failing: failing.length,
    medianRelErrorAmongFailing: rels.length ? rels[Math.floor(rels.length / 2)]! : null,
    maxAbsErrorAmongFailing: failing.length ? failing.reduce((m, c) => Math.max(m, c.absError!), 0) : null,
  };
}

export interface InsightRow { type: string; tp: number; fp: number; fn: number; tn: number; precision: number; recall: number; f1: number; f1Ci: Interval; labelled: number }

function insightRows(checks: Check[]): { rows: InsightRow[]; micro: InsightRow } {
  const ins = checks.filter((c) => c.category === "insight");
  const mk = (type: string, cs: Check[]): InsightRow => {
    const counts: Counts = { tp: 0, fp: 0, fn: 0, tn: 0 };
    cs.forEach((c) => (counts[c.outcome!] += 1));
    const { precision, recall, f1 } = prf(counts);
    return { type, ...counts, precision, recall, f1, f1Ci: bootstrapF1(cs.map((c) => c.outcome!)), labelled: cs.length };
  };
  const rows = FINDING_TYPES.map((t) => mk(t, ins.filter((c) => c.check === t))).filter((r) => r.labelled > 0);
  return { rows, micro: mk("ALL (micro)", ins) };
}

export interface Headline { id: string; name: string; definition: string; n: number; pass: number; rate: number; ci: Interval; meetsTarget: boolean; lowerBoundMeetsTarget: boolean }

export interface SplitSummary {
  split: string;
  cases: { pipeline: number; cells: number; classify: number };
  headline: Headline[];
  numeric: {
    comparisons: Rate;
    comparisonsUnambiguous: Rate;
    cases: Rate;
    casesUnambiguous: Rate;
    byMetric: Record<string, Rate & { maxAbsError: number }>;
    byFamily: Record<string, Rate>;
    failuresBySeverity: Record<string, number>;
    magnitude: ErrorMagnitude;
  };
  availability: Rate & { byMetric: Record<string, Rate> };
  cells: { overall: Rate; byKind: Record<string, Rate>; silentCorruption: number; falseRejections: number };
  classify: { byKind: Record<string, Rate> };
  insight: { rows: InsightRow[]; micro: InsightRow; falsePositives: Check[]; falseNegatives: Check[]; ungradedEmissions: Record<string, number> };
  grounding: {
    evidenceExists: Rate; evidenceValue: Rate; findingEvidenceValue: Rate;
    observedClaims: Rate; heuristicClaims: Rate; hypotheticalClaims: number;
    unsupportedObserved: string; unsupportedHeuristic: string;
    byCheck: Record<string, Rate>;
  };
  safety: { overall: Rate; byCheck: Record<string, Rate>; declaredUnsupported: Check[] };
  invariants: { overall: Rate; byName: Record<string, Rate> };
  criticalFailures: Check[];
}

const mkHeadline = (id: string, name: string, definition: string, r: Rate): Headline => ({
  id, name, definition, n: r.n, pass: r.pass, rate: r.rate, ci: r.ci,
  meetsTarget: r.n > 0 && r.rate >= TARGET_RATE,
  lowerBoundMeetsTarget: r.n > 0 && r.ci.lower >= TARGET_RATE,
});

export function summarize(split: string, checks: Check[], counts: { pipeline: number; cells: number; classify: number }, ungraded: string[]): SplitSummary {
  const numeric = checks.filter((c) => c.category === "numeric");
  const avail = checks.filter((c) => c.category === "availability");
  const cell = checks.filter((c) => c.category === "cell" && !c.check.endsWith("rejection-recorded") && c.status !== "na");
  const cellAll = checks.filter((c) => c.category === "cell");
  const classify = checks.filter((c) => c.category === "classify");
  const insight = insightRows(checks);
  const grounding = checks.filter((c) => c.category === "grounding");
  const safety = checks.filter((c) => c.category === "safety");
  const inv = checks.filter((c) => c.category === "invariant");
  const numAndAvail = [...numeric, ...avail];

  const byMetric: Record<string, Rate & { maxAbsError: number }> = {};
  for (const [k, cs] of group(numeric, (c) => c.check.replace(/^scenario\d+\./, "scenario."))) {
    byMetric[k] = { ...rateOf(cs), maxAbsError: cs.reduce((m, c) => Math.max(m, c.absError ?? 0), 0) };
  }
  const byFamily: Record<string, Rate> = {};
  for (const [k, cs] of group(numAndAvail, (c) => c.family)) byFamily[k] = rateOf(cs);
  const failuresBySeverity: Record<string, number> = { critical: 0, major: 0, minor: 0 };
  numAndAvail.filter((c) => c.status === "fail").forEach((c) => (failuresBySeverity[c.severity] = (failuresBySeverity[c.severity] ?? 0) + 1));

  const availByMetric: Record<string, Rate> = {};
  for (const [k, cs] of group(avail, (c) => c.check.replace(/^scenario\d+\./, "scenario."))) availByMetric[k] = rateOf(cs);

  const byKind = (cs: Check[], key: (c: Check) => string): Record<string, Rate> => Object.fromEntries([...group(cs, key)].map(([k, v]) => [k, rateOf(v)]));
  const claims = (kind: string): Check[] => grounding.filter((c) => c.claimKind === kind && (c.check.startsWith("claim:") || c.check === "evidence-value" || c.check === "evidence-exists" || c.check === "finding-evidence-value"));
  const observedClaims = grounding.filter((c) => c.claimKind === "observed" && c.check.startsWith("claim:"));
  const heuristicClaims = grounding.filter((c) => c.claimKind === "heuristic" && c.check.startsWith("claim:"));
  const hypothetical = grounding.filter((c) => c.claimKind === "hypothetical" && c.check.startsWith("claim:"));
  void claims;
  const obsRate = rateOf(observedClaims);
  const heurRate = rateOf(heuristicClaims);

  const summary: SplitSummary = {
    split,
    cases: counts,
    headline: [],
    numeric: {
      comparisons: rateOf(numeric),
      comparisonsUnambiguous: rateOf(numeric.filter((c) => !c.ambiguous)),
      cases: casesPassing(numAndAvail),
      casesUnambiguous: casesPassing(numAndAvail.filter((c) => !c.ambiguous)),
      byMetric, byFamily, failuresBySeverity, magnitude: magnitude(checks),
    },
    availability: { ...rateOf(avail), byMetric: availByMetric },
    cells: {
      overall: rateOf(cell),
      byKind: byKind(cell, (c) => c.check),
      silentCorruption: cell.filter((c) => c.status === "fail" && c.severity === "critical").length + cellAll.filter((c) => c.check.endsWith("rejection-recorded") && c.status === "fail").length,
      falseRejections: cell.filter((c) => c.status === "fail" && c.severity === "major").length,
    },
    classify: { byKind: byKind(classify, (c) => c.check) },
    insight: {
      rows: insight.rows, micro: insight.micro,
      falsePositives: checks.filter((c) => c.category === "insight" && c.outcome === "fp"),
      falseNegatives: checks.filter((c) => c.category === "insight" && c.outcome === "fn"),
      ungradedEmissions: Object.fromEntries([...group(ungraded, (x) => x)].map(([k, v]) => [k, v.length])),
    },
    grounding: {
      evidenceExists: rateOf(grounding.filter((c) => c.check === "evidence-exists")),
      evidenceValue: rateOf(grounding.filter((c) => c.check === "evidence-value")),
      findingEvidenceValue: rateOf(grounding.filter((c) => c.check === "finding-evidence-value")),
      observedClaims: obsRate, heuristicClaims: heurRate, hypotheticalClaims: hypothetical.length,
      unsupportedObserved: `${obsRate.fail}/${obsRate.n}`, unsupportedHeuristic: `${heurRate.fail}/${heurRate.n}`,
      byCheck: byKind(grounding, (c) => c.check),
    },
    safety: {
      overall: rateOf(safety.filter((c) => c.check !== "declared-unsupported")),
      byCheck: byKind(safety.filter((c) => c.check !== "declared-unsupported"), (c) => c.check.split(":")[0]!),
      declaredUnsupported: safety.filter((c) => c.check === "declared-unsupported"),
    },
    invariants: { overall: rateOf(inv), byName: byKind(inv, (c) => c.check.split(":")[0]!) },
    criticalFailures: checks.filter((c) => c.status === "fail" && c.severity === "critical"),
  };

  const groundingNumeric = rateOf(grounding.filter((c) => c.claimKind === "observed" && (c.check === "evidence-value" || c.check === "claim:number" || c.check === "evidence-exists")));
  summary.headline = [
    mkHeadline("A1", "Numerical correctness - per comparison", "Fraction of oracle-eligible metric comparisons within the predefined tolerance.", summary.numeric.comparisons),
    mkHeadline("A2", "Numerical correctness - per case", "Fraction of cases in which EVERY numeric and availability expectation is met.", summary.numeric.cases),
    mkHeadline("A3", "Numerical correctness - per case, unambiguous cases only", "As A2, excluding cases that rest on a documented interpretation where another is valid.", summary.numeric.casesUnambiguous),
    mkHeadline("A4", "Cell parsing - correct or safely rejected", "Fraction of raw amount/date cells read correctly or rejected with a recorded reason.", summary.cells.overall),
    mkHeadline("A5", "Categorisation (keyword heuristic)", "Fraction of descriptions mapped to the human-labelled category.", summary.classify.byKind["category"] ?? rateOf([])),
    mkHeadline("A6", "Asset-class mapping (keyword heuristic)", "Fraction of asset-class labels mapped to the human-labelled class.", summary.classify.byKind["assetClass"] ?? rateOf([])),
    {
      id: "B1", name: "Insight correctness - micro F1", definition: "F1 over every graded finding-type label (rules, anomalies, trend rises, cash-flow and spending findings).",
      n: insight.micro.labelled, pass: insight.micro.tp + insight.micro.tn, rate: insight.micro.f1, ci: insight.micro.f1Ci,
      // The bootstrap interval is degenerate when every label is right, so the lower bound that
      // counts is the more conservative of it and the Wilson bound on label accuracy.
      meetsTarget: insight.micro.f1 >= TARGET_RATE,
      lowerBoundMeetsTarget: Math.min(insight.micro.f1Ci.lower, wilson(insight.micro.tp + insight.micro.tn, insight.micro.labelled).lower) >= TARGET_RATE,
    },
    mkHeadline("B2", "Insight labels - accuracy", "(TP+TN) / graded labels. Reported with a Wilson interval because the F1 bootstrap interval collapses to a point when every label is correct.", rateOf(checks.filter((c) => c.category === "insight"))),
    mkHeadline("C1", "Evidence grounding - observed facts", "Fraction of insight evidence items that exist in the report AND whose entity, period and value match the source data, plus numbers quoted in insight text.", groundingNumeric),
    mkHeadline("C2", "Evidence grounding - attribution claims", "Fraction of heuristic attributions (driver, one-off, reserves) that the source data supports.", summary.grounding.heuristicClaims),
    mkHeadline("D1", "Data safety and abstention", "Fraction of safety expectations met (errors, warnings, skipped rows with reasons, refusal to guess, unavailable measures).", summary.safety.overall),
    mkHeadline("D2", "Invariants", "Fraction of invariant checks holding across every successfully analysed case.", summary.invariants.overall),
  ];
  return summary;
}
