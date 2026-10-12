import type { AnalysisResult } from "../../src/index.js";
import { specFor, tolerance } from "../metrics.js";
import type { Expected } from "../oracle/oracle.js";
import { expectedFor } from "./expected.js";
import type { Execution } from "./execute.js";
import { mkCheck, type Check, type CaseMeta } from "./records.js";

export const metaOf = (e: Execution): CaseMeta => ({ id: e.case.id, split: e.case.split, family: e.case.family, ambiguous: Boolean(e.case.ambiguous) });

/** An info finding that states the measure is unavailable explains a placeholder zero. */
const EXPLAINS = /\b(no |insufficient|need|too few|not assessed|absent|skipped|requires|without|entirely)/i;

export function metricOf(results: AnalysisResult[], mod: string, key: string): number | undefined {
  return results.find((r) => r.module === mod)?.metrics.find((m) => m.key === key)?.value;
}
export function explained(results: AnalysisResult[], mod: string): boolean {
  return Boolean(results.find((r) => r.module === mod)?.findings.some((f) => f.severity === "info" && EXPLAINS.test(f.message)));
}

/** Compare one expected value against what Forge reported. */
export function compare(meta: CaseMeta, key: string, expected: number | null, actual: number | undefined, explainedZero: boolean): Check {
  const spec = specFor(key);
  if (expected === null) {
    // Must be unavailable: absent, or a zero accompanied by an explicit "unavailable" finding.
    const ok = actual === undefined || (actual === 0 && explainedZero);
    return mkCheck(meta, "availability", key, ok ? "pass" : "fail", "critical", {
      expected: "unavailable", actual: actual === undefined ? "absent" : actual,
      detail: ok ? undefined : "a value was reported where the measure is undefined (silent conversion of missing data)",
    });
  }
  if (actual === undefined) {
    return mkCheck(meta, "numeric", key, "fail", spec.severity, { expected, actual: "absent", detail: "metric missing from report" });
  }
  if (!Number.isFinite(actual)) {
    return mkCheck(meta, "numeric", key, "fail", "critical", { expected, actual, detail: "non-finite value" });
  }
  const abs = Math.abs(actual - expected);
  const tol = tolerance(spec.unit, expected);
  const pass = abs <= tol;
  const rel = expected !== 0 ? abs / Math.abs(expected) : abs;
  let severity = spec.severity;
  if (!pass && spec.unit === "score" && abs <= 1) severity = "minor";
  return mkCheck(meta, "numeric", key, pass ? "pass" : "fail", pass ? spec.severity : severity, {
    expected, actual, absError: abs, relError: rel, detail: pass ? undefined : `tolerance ${tol}`,
  });
}

export function numericChecks(e: Execution): Check[] {
  const c = e.case;
  if (!e.report || c.expect?.metrics === false) return [];
  const meta = metaOf(e);
  const exp: Expected = expectedFor(c);
  const out: Check[] = [];

  const ambiguousIf = (check: Check, flag: boolean): Check => (flag && /(^|.)health.score$/.test(check.check) ? { ...check, ambiguous: true } : check);
  for (const [key, value] of Object.entries(exp.values)) {
    const dot = key.indexOf(".");
    const mod = key.slice(0, dot);
    const k = key.slice(dot + 1);
    out.push(ambiguousIf(compare(meta, key, value, metricOf(e.report.analyses, mod, k), explained(e.report.analyses, mod)), exp.extras.capAmbiguous));
  }

  // Anomaly flag set against the documented rule (only where the rule is defined).
  if (exp.extras.anomalyFlags !== null) {
    const flagged = forgeFlaggedIndices(e);
    const want = [...exp.extras.anomalyFlags].sort((a, b) => a - b);
    const got = [...flagged].sort((a, b) => a - b);
    const same = want.length === got.length && want.every((v, i) => v === got[i]);
    out.push(mkCheck(meta, "numeric", "anomaly.flaggedSet", same ? "pass" : "fail", "major", {
      expected: want.map((i) => c.truth.txns[i]!.description), actual: got.map((i) => c.truth.txns[i]!.description),
    }));
  }

  e.sims.forEach((s, idx) => {
    if (!s.result) {
      out.push(mkCheck(meta, "numeric", `scenario${idx}.run`, "fail", "major", { actual: s.error?.name, detail: s.error?.message }));
      return;
    }
    const sc = exp.scenarios[idx]!;
    for (const [key, value] of Object.entries(sc.values)) {
      const rest = key.replace(/^scenario\d+\./, "");
      if (rest.startsWith("delta.")) {
        const tracked = rest.slice("delta.".length);
        const row = s.result.deltas.find((d) => d.key === tracked);
        // A delta row for a quantity that is undefined on either side would be a fabricated number.
        out.push(ambiguousIf(compare(meta, key, value, row?.delta, false), sc.capAmbiguous || exp.extras.capAmbiguous));
      } else {
        const dot = rest.indexOf(".");
        out.push(ambiguousIf(compare(meta, key, value, metricOf(s.result.scenarioResults, rest.slice(0, dot), rest.slice(dot + 1)), explained(s.result.scenarioResults, rest.slice(0, dot))), sc.capAmbiguous));
      }
    }
  });
  return out;
}

/** Indices (into truth.txns) of the transactions Forge flagged as anomalies. */
export function forgeFlaggedIndices(e: Execution): number[] {
  const anomaly = e.report?.analyses.find((a) => a.module === "anomaly");
  if (!anomaly) return [];
  const out: number[] = [];
  for (const ev of anomaly.evidence) {
    const idx = e.case.truth.txns.findIndex((t, i) => !out.includes(i) && ev.label === `${t.date} ${t.description}` && ev.value !== undefined && Math.abs(Math.abs(Number(t.amount)) - ev.value) < 1e-6);
    if (idx >= 0) out.push(idx);
  }
  return out;
}
