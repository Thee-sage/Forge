import { basename } from "node:path";
import { compare, explained, metaOf, metricOf } from "./numeric.js";
import { expectedFor } from "./expected.js";
import type { Execution } from "./execute.js";
import { mkCheck, type Check } from "./records.js";

/**
 * Data safety and abstention (metric family D): documented errors, warnings, skipped-row
 * reasons, unavailable measures, refusal of invalid scenarios, and refusal to guess.
 */
export function safetyChecks(e: Execution): Check[] {
  const c = e.case;
  const meta = metaOf(e);
  const ex = c.expect ?? {};
  const out: Check[] = [];
  const r = e.report;
  const warnings = r?.normalization.warnings ?? [];
  const skipped = r?.normalization.skippedRows ?? [];
  const tableName = (t: "transactions" | "holdings"): string | undefined => (t === "transactions" ? e.txnFile : e.holdFile);
  const wasSkipped = (t: "transactions" | "holdings", row: number): boolean =>
    skipped.some((s) => s.table === tableName(t) && s.row === row && s.reason.length > 0);

  if (c.declaredUnsupported) {
    out.push(mkCheck(meta, "safety", "declared-unsupported", "na", "minor", {
      detail: c.declaredUnsupported,
      actual: warnings.some((w) => /duplicate/i.test(w)) ? "Forge warned" : "Forge did not warn",
    }));
    return out;
  }

  if (ex.error) {
    out.push(mkCheck(meta, "safety", "expected-error", e.error?.name === ex.error ? "pass" : "fail", "critical", {
      expected: ex.error, actual: e.error?.name ?? "no error (pipeline proceeded)",
    }));
  } else if (e.error && !ex.abstain?.error) {
    out.push(mkCheck(meta, "safety", "no-unexpected-error", "fail", "critical", { expected: "success", actual: `${e.error.name}: ${e.error.message}` }));
  }

  for (const pattern of ex.warnings ?? []) {
    if (ex.error) continue; // the pipeline refused before producing a report
    out.push(mkCheck(meta, "safety", `warning:${pattern}`, warnings.some((w) => new RegExp(pattern, "i").test(w)) ? "pass" : "fail", "major", { expected: pattern, actual: warnings.length ? warnings : "no warnings" }));
  }
  for (const pattern of ex.forbiddenWarnings ?? []) {
    out.push(mkCheck(meta, "safety", `no-warning:${pattern}`, warnings.some((w) => new RegExp(pattern, "i").test(w)) ? "fail" : "pass", "minor", { expected: `no warning matching ${pattern}`, actual: warnings }));
  }
  for (const s of ex.skipped ?? []) {
    const hit = skipped.find((x) => x.table === tableName(s.table) && x.row === s.row);
    const pass = Boolean(hit && new RegExp(s.reason, "i").test(hit.reason));
    out.push(mkCheck(meta, "safety", `skipped:${s.table}#${s.row}`, pass ? "pass" : "fail", "critical", { expected: `skipped (${s.reason})`, actual: hit ? hit.reason : "row was accepted" }));
  }
  if (ex.abstain) {
    const a = ex.abstain;
    const safe =
      (a.error !== undefined && e.error?.name === a.error) ||
      (a.row !== undefined && wasSkipped(a.row.table, a.row.index)) ||
      (a.warning !== undefined && warnings.some((w) => new RegExp(a.warning!, "i").test(w)));
    out.push(mkCheck(meta, "safety", "abstain", safe ? "pass" : "fail", "critical", {
      expected: "refuse (error, skipped row with reason, or warning)", actual: e.error?.name ?? (warnings.length ? "no matching warning" : "silently accepted"),
    }));
  }
  if (r) {
    const exp = ex.metrics === false ? undefined : expectedFor(c);
    for (const key of ex.unavailable ?? []) {
      if (exp && exp.values[key] === null) continue; // already scored by the numeric runner
      const dot = key.indexOf(".");
      const mod = key.slice(0, dot);
      out.push(compare(meta, key, null, metricOf(r.analyses, mod, key.slice(dot + 1)), explained(r.analyses, mod)));
    }
  }
  if (ex.scenarioMustReject) {
    e.sims.forEach((s, i) => {
      out.push(mkCheck(meta, "safety", `scenario${i}-rejected`, s.error?.forge ? "pass" : "fail", "critical", {
        expected: "ForgeError", actual: s.error ? s.error.name : "accepted", detail: s.result ? `produced amounts: ${JSON.stringify(s.result.deltas.slice(0, 2))}` : undefined,
      }));
    });
  }

  if (r && ex.metrics !== false) {
    out.push(mkCheck(meta, "safety", "currency-label", r.model.currency === c.truth.currency && r.model.currencies.length <= 1 ? "pass" : "fail", "major", {
      expected: c.truth.currency, actual: r.model.currency,
    }));
    const wantT = c.truth.txns.length;
    const gotT = r.model.transactions.length;
    out.push(mkCheck(meta, "safety", "rows-accepted:transactions", gotT === wantT ? "pass" : "fail", gotT > wantT ? "critical" : "major", { expected: wantT, actual: gotT }));
    const wantH = c.truth.holdings.length;
    const gotH = r.model.holdings.length;
    out.push(mkCheck(meta, "safety", "rows-accepted:holdings", gotH === wantH ? "pass" : "fail", gotH > wantH ? "critical" : "major", { expected: wantH, actual: gotH }));
  }
  void basename;
  return out;
}
