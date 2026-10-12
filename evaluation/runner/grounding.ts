import type { AnalysisResult, Evidence, Insight } from "../../src/index.js";
import { metaOf } from "./numeric.js";
import { expectedFor } from "./expected.js";
import type { Execution } from "./execute.js";
import { mkCheck, type Check, type CaseMeta } from "./records.js";
import type { Expected } from "../oracle/oracle.js";

/**
 * Evidence grounding.
 *
 * Every evidence item and every number or attribution quoted in an insight is checked
 * against the oracle (which is computed from the ground-truth source data, never from
 * Forge's output). Claims are classed as:
 *   observed     a directly checkable fact about the data (an amount, a share, a count)
 *   heuristic    an interpretation / attribution ("driven mainly by X", "reserves are being built")
 *   hypothetical a statement about what would happen (not checkable; counted, never scored)
 */

const MONEY = /(-?)(?:[$€£₹¥]|A\$|C\$)([\d,]+\.\d{2})|(-?)([\d,]+\.\d{2}) [A-Z]{3}\b/g;

function moneyTokens(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(MONEY)) {
    const sign = (m[1] ?? m[3]) === "-" ? -1 : 1;
    out.push(sign * Number((m[2] ?? m[4])!.replace(/,/g, "")));
  }
  return out;
}

const ASSET_CLASSES = ["equity", "fixed_income", "cash", "real_estate", "commodity", "crypto", "alternative", "unknown"];
const near = (a: number, b: number, tol: number): boolean => Math.abs(a - b) <= tol + 1e-9;

/** Every scalar a correct explanation may cite, derived from the oracle (never from Forge's output). */
function universeOf(exp: Expected): number[] {
  const u = [...exp.extras.universe];
  const out = exp.values["cashflow.outflow"];
  if (typeof out === "number" && out > 0) {
    for (const v of Object.values(exp.extras.categoryTotals)) u.push(v / out);
    const largest = exp.values["anomaly.largest"];
    if (typeof largest === "number") u.push(largest / out);
  }
  for (const t of Object.values(exp.extras.trend)) {
    u.push(t.early, t.recent, t.recent - t.early);
    if (t.early > 0) u.push((t.recent - t.early) / t.early);
  }
  if (exp.extras.halfNets) u.push(exp.extras.halfNets.earlier, exp.extras.halfNets.recent);
  return u;
}

const inUniverse = (x: number, u: number[], tol: number): boolean => u.some((v) => near(x, v, tol));

type Verdict = { status: "pass" | "fail" | "na"; detail?: string };
const ok = (): Verdict => ({ status: "pass" });
const bad = (detail: string): Verdict => ({ status: "fail", detail });
const na = (detail: string): Verdict => ({ status: "na", detail });

/** Verify one evidence item's label (entity/period), value, sign and quoted amounts against the oracle. */
function verifyEvidence(e: Execution, exp: Expected, module: string, ev: Evidence): Verdict {
  const truth = e.case.truth;
  const v = exp.values;
  const num = (k: string): number | undefined => (typeof v[k] === "number" ? (v[k] as number) : undefined);
  const money = (ev.detail ?? "");
  const tokens = moneyTokens(money);
  const universe = universeOf(exp);
  const stray = tokens.find((t) => !inUniverse(Math.abs(t), universe.map(Math.abs), 0.005));
  const checkValue = (want: number | undefined, tol = 1e-6): Verdict => {
    if (want === undefined) return na("no oracle value");
    if (ev.value === undefined) return bad("evidence carries no value");
    return near(ev.value, want, tol + 1e-9 * Math.abs(want)) ? ok() : bad(`value ${ev.value} != expected ${want}`);
  };
  let verdict: Verdict;

  switch (module) {
    case "cashflow": {
      if (/^\d{4}-\d{2}$/.test(ev.label)) {
        const m = exp.extras.monthly.find((x) => x.month === ev.label);
        if (!m) return bad(`month ${ev.label} has no transactions in the source data`);
        verdict = checkValue(m.net);
        if (verdict.status === "pass" && tokens.length === 3) {
          const want = [m.inflow, m.outflow, m.net];
          if (!tokens.every((t, i) => near(t, want[i]!, 0.005))) verdict = bad(`detail amounts ${tokens.join("/")} != ${want.join("/")}`);
        }
      } else if (ev.label === "inflow") verdict = checkValue(num("cashflow.inflow"));
      else if (ev.label === "outflow") verdict = checkValue(num("cashflow.outflow"));
      else if (ev.label === "net saved") verdict = checkValue(num("cashflow.net"));
      else if (ev.label === "earlier avg net") verdict = checkValue(exp.extras.halfNets?.earlier);
      else if (ev.label === "recent avg net") verdict = checkValue(exp.extras.halfNets?.recent);
      else verdict = na("unrecognised cashflow evidence");
      break;
    }
    case "expenditure": {
      if (ev.label === "total outflow") verdict = checkValue(num("expenditure.totalOutflow"));
      else if (ev.label in exp.extras.categoryTotals) {
        verdict = checkValue(exp.extras.categoryTotals[ev.label]);
        const pct = /\((-?\d+(?:\.\d+)?)%\)/.exec(ev.detail);
        const out = num("expenditure.totalOutflow");
        if (verdict.status === "pass" && pct && out) {
          if (!near(Number(pct[1]), (exp.extras.categoryTotals[ev.label]! / out) * 100, 0.05)) verdict = bad(`share ${pct[1]}% != ${(exp.extras.categoryTotals[ev.label]! / out) * 100}%`);
        }
      } else verdict = bad(`category "${ev.label}" does not exist in the source data`);
      break;
    }
    case "trend": {
      const t = exp.extras.trend[ev.label];
      if (!t) return ev.label === "earlier avg" || ev.label === "recent avg" ? na("unlabelled average") : bad(`category "${ev.label}" has no spending in the source data`);
      verdict = checkValue(t.recent - t.early);
      if (verdict.status === "pass" && tokens.length >= 2 && !(near(tokens[0]!, t.early, 0.005) && near(tokens[1]!, t.recent, 0.005))) verdict = bad(`detail ${tokens.join("→")} != ${t.early}→${t.recent}`);
      break;
    }
    case "anomaly": {
      if (ev.label === "typical (median)") verdict = checkValue(num("anomaly.medianOutflow"));
      else {
        const named = truth.txns.filter((t) => `${t.date} ${t.description}` === ev.label || t.description === ev.label);
        if (named.length === 0) return bad(`transaction "${ev.label}" does not exist in the source data`);
        const hit = named.find((t) => ev.value !== undefined && near(Math.abs(Number(t.amount)), ev.value, 1e-6));
        if (!hit) verdict = bad(`no transaction "${ev.label}" has amount ${ev.value}`);
        else if (Number(hit.amount) > 0) verdict = bad("anomaly evidence refers to an inflow");
        else verdict = ok();
      }
      break;
    }
    case "allocation": {
      if (ev.label in exp.extras.classValues) {
        verdict = checkValue(exp.extras.classValues[ev.label]);
        const pct = /\((-?\d+(?:\.\d+)?)%\)/.exec(ev.detail);
        const total = num("allocation.portfolioValue");
        if (verdict.status === "pass" && pct && total) {
          if (!near(Number(pct[1]), (exp.extras.classValues[ev.label]! / total) * 100, 0.05)) verdict = bad(`weight ${pct[1]}% != ${(exp.extras.classValues[ev.label]! / total) * 100}%`);
        }
      } else if (ASSET_CLASSES.includes(ev.label)) {
        verdict = checkValue(0); // the class is absent from the portfolio: its value is genuinely 0
      } else verdict = bad(`asset class "${ev.label}" does not exist in the source data`);
      break;
    }
    case "concentration": {
      const dup = truth.holdings.filter((h) => h.symbol === ev.label).length;
      if (dup === 1) {
        verdict = checkValue(exp.extras.holdingWeights[ev.label]);
        const pct = /\((-?\d+(?:\.\d+)?)%\)/.exec(ev.detail);
        if (verdict.status === "pass" && pct && !near(Number(pct[1]), exp.extras.holdingWeights[ev.label]! * 100, 0.05)) verdict = bad(`weight ${pct[1]}% != ${exp.extras.holdingWeights[ev.label]! * 100}%`);
      } else if (dup > 1) verdict = na("duplicate symbol (position identity ambiguous)");
      else verdict = na("aggregate evidence");
      break;
    }
    case "health": {
      const map: Record<string, string> = {
        composite: "health.score", savings: "health.savingsScore", "expense discipline": "health.expenseScore",
        "cash-flow stability": "health.stabilityScore", "liquidity runway": "health.liquidityScore", diversification: "health.diversificationScore",
      };
      const key = map[ev.label];
      verdict = key ? checkValue(num(key), key === "health.score" ? 0 : 1e-9) : na("unrecognised health evidence");
      break;
    }
    default:
      verdict = na(`no verifier for module ${module}`);
  }
  if (verdict.status === "pass" && stray !== undefined && !(module === "health")) return bad(`quoted amount ${stray} does not occur in the source data`);
  return verdict;
}

/** All evidence entries Forge published for a module (module evidence + finding evidence). */
function publishedEvidence(results: AnalysisResult[], module: string): Evidence[] {
  const r = results.find((x) => x.module === module);
  return r ? [...r.evidence, ...r.findings.flatMap((f) => f.evidence)] : [];
}

interface NumClaim { text: string; ok: boolean }
function numericClaims(text: string, exp: Expected): NumClaim[] {
  const u = universeOf(exp);
  const claims: NumClaim[] = [];
  for (const m of text.matchAll(/(-?\d+(?:\.\d+)?)%/g)) claims.push({ text: m[0], ok: inUniverse(Number(m[1]), u.map((x) => x * 100), 0.05) });
  for (const t of moneyTokens(text)) claims.push({ text: `amount ${t}`, ok: inUniverse(Math.abs(t), u.map(Math.abs), 0.005) });
  for (const m of text.matchAll(/HHI\s+(\d+\.\d+)/g)) claims.push({ text: m[0], ok: inUniverse(Number(m[1]), u, 0.005) });
  for (const m of text.matchAll(/about (\d+\.\d) month/g)) claims.push({ text: m[0], ok: inUniverse(Number(m[1]), u, 0.05) });
  for (const m of text.matchAll(/(\d+)\/100/g)) claims.push({ text: m[0], ok: inUniverse(Number(m[1]), u, 0.5) });
  return claims;
}

/** Semantic claims per rule: attribution and one-off/reserve assertions the numbers alone do not capture. */
function ruleClaims(e: Execution, exp: Expected, ins: Insight): { check: string; kind: "observed" | "heuristic" | "hypothetical"; verdict: Verdict }[] {
  const out: { check: string; kind: "observed" | "heuristic" | "hypothetical"; verdict: Verdict }[] = [];
  const v = exp.values;
  const num = (k: string): number | undefined => (typeof v[k] === "number" ? (v[k] as number) : undefined);
  const push = (check: string, kind: "observed" | "heuristic" | "hypothetical", verdict: Verdict): void => void out.push({ check, kind, verdict });

  switch (ins.ruleId) {
    case "cashflow-decline-driver": {
      const h = exp.extras.halfNets;
      push("claim:net-trending-down", "observed", h ? (h.recent < h.earlier ? ok() : bad(`recent mean net ${h.recent} is not below earlier ${h.earlier}`)) : na("needs >= 2 active months"));
      const rising = /rising "([^"]+)"/.exec(ins.explanation);
      const deltas = Object.entries(exp.extras.trend).map(([c, t]) => ({ c, d: t.recent - t.early }));
      if (rising) {
        const best = deltas.filter((x) => x.d > 0).sort((a, b) => b.d - a.d)[0];
        const mine = deltas.find((x) => x.c === rising[1]);
        push("claim:attribution-rising-category", "heuristic", mine && mine.d > 0 && best && best.c === rising[1] ? ok() : bad(`"${rising[1]}" is not the largest rising category (largest: ${best?.c ?? "none"})`));
      }
      if (ins.drivers.some((d) => /higher outflow/.test(d))) {
        const mon = exp.extras.monthly;
        const mid = Math.floor(mon.length / 2);
        const avg = (xs: typeof mon): number => xs.reduce((a, m) => a + m.outflow, 0) / (xs.length || 1);
        const early = avg(mon.slice(0, mid));
        const recent = avg(mon.slice(mid));
        push("claim:driver-higher-outflow", "observed", recent > early + 1e-9 ? ok() : bad(`recent mean monthly outflow ${recent} is not above earlier ${early}`));
      }
      break;
    }
    case "low-savings-driver": {
      const m = /biggest outflow is "([^"]+)"/.exec(ins.explanation);
      if (m) {
        const ranked = Object.entries(exp.extras.categoryTotals).sort((a, b) => b[1] - a[1]);
        const tie = ranked.length > 1 && ranked[0]![1] === ranked[1]![1];
        push("claim:top-category", "observed", tie ? na("tie") : ranked[0]?.[0] === m[1] ? ok() : bad(`top category is "${ranked[0]?.[0]}", not "${m[1]}"`));
      }
      if (/exceeds income/i.test(ins.headline)) push("claim:spending-exceeds-income", "observed", (num("cashflow.net") ?? 0) < 0 ? ok() : bad("net cash flow is not negative"));
      break;
    }
    case "portfolio-concentration": {
      const m = /driven mainly by (\S+) at/.exec(ins.explanation);
      if (m) {
        const nonCash = e.case.truth.holdings.filter((h) => h.assetClass !== "cash").sort((a, b) => Number(b.value) - Number(a.value));
        const holding = e.case.truth.holdings.find((h) => h.symbol === m[1]);
        push("claim:driver-is-top-investment", "observed", !holding ? bad(`"${m[1]}" is not a holding`) : holding.assetClass === "cash" ? bad(`"${m[1]}" is cash, which is excluded from market concentration`) : nonCash[0]?.symbol === m[1] ? ok() : bad(`largest investment is ${nonCash[0]?.symbol}`));
      }
      push("claim:shock-would-move-portfolio", "hypothetical", na("hypothetical"));
      break;
    }
    case "thin-liquidity":
      push("claim:forced-selling", "hypothetical", na("hypothetical"));
      break;
    case "anomaly-impact": {
      const m = /largest outflow \(\$?([\d,]+\.\d{2})\)/.exec(ins.explanation);
      if (m) {
        const amt = Number(m[1]!.replace(/,/g, ""));
        const counts = new Map<string, number>();
        exp.extras.outflowIndices.forEach((i) => {
          const k = Math.abs(Number(e.case.truth.txns[i]!.amount)).toFixed(2);
          counts.set(k, (counts.get(k) ?? 0) + 1);
        });
        const recurring = (counts.get(amt.toFixed(2)) ?? 0) >= 3;
        const flags = exp.extras.anomalyFlags;
        const flaggedAmt = flags ? flags.some((i) => near(Math.abs(Number(e.case.truth.txns[i]!.amount)), amt, 0.005)) : undefined;
        push("claim:largest-is-one-off", "observed", recurring ? bad(`${amt} recurs ${counts.get(amt.toFixed(2))} times; it is not a one-off`) : flaggedAmt === false ? bad(`${amt} was not an outlier under the documented rule`) : ok());
      }
      break;
    }
    case "healthy-position": {
      push("claim:income-exceeds-spending", "observed", (num("cashflow.net") ?? 0) > 0 ? ok() : bad("net cash flow is not positive"));
      push("claim:reserves-being-built", "heuristic", (num("cashflow.net") ?? 0) > 0 ? ok() : bad("net savings are not positive: nothing is being added to reserves"));
      break;
    }
  }
  return out;
}

export function groundingChecks(e: Execution): Check[] {
  if (!e.report || e.case.expect?.metrics === false) return [];
  const meta: CaseMeta = metaOf(e);
  const exp = expectedFor(e.case);
  const out: Check[] = [];
  const r = e.report;

  for (const ins of r.insights) {
    const tag = `${ins.ruleId}`;
    for (const ev of ins.evidence) {
      const mod = ev.module;
      const exists = Boolean(mod) && ins.basis.includes(mod!) && publishedEvidence(r.analyses, mod!).some((x) => x.label === ev.label && x.detail === ev.detail);
      out.push(mkCheck(meta, "grounding", "evidence-exists", exists ? "pass" : "fail", "major", { claimKind: "observed", actual: `${tag}: ${mod ?? "(no module)"}/${ev.label}`, detail: exists ? undefined : "evidence not present in the cited module's published evidence" }));
      if (mod) {
        const v = verifyEvidence(e, exp, mod, ev);
        out.push(mkCheck(meta, "grounding", "evidence-value", v.status, "major", { claimKind: "observed", actual: `${tag}: ${mod}/${ev.label}=${ev.value}`, detail: v.detail }));
      }
    }
    for (const c of numericClaims(ins.explanation, exp)) {
      out.push(mkCheck(meta, "grounding", "claim:number", c.ok ? "pass" : "fail", "major", { claimKind: "observed", actual: `${tag}: ${c.text}`, detail: c.ok ? undefined : "number does not correspond to any quantity derived from the source data" }));
    }
    for (const c of ruleClaims(e, exp, ins)) {
      out.push(mkCheck(meta, "grounding", c.check, c.verdict.status, "major", { claimKind: c.kind, actual: tag, detail: c.verdict.detail }));
    }
  }

  // Evidence inside module findings must also be true.
  for (const a of r.analyses) {
    for (const f of a.findings) {
      for (const ev of f.evidence) {
        const v = verifyEvidence(e, exp, a.module, ev);
        out.push(mkCheck(meta, "grounding", "finding-evidence-value", v.status, "major", { claimKind: "observed", actual: `${a.module}/${ev.label}=${ev.value}`, detail: v.detail }));
      }
    }
  }

  // Scenario outcomes are hypothetical: they must be labelled as such and quote correct numbers.
  e.sims.forEach((s, idx) => {
    if (!s.result) return;
    const sc = exp.scenarios[idx]!.values;
    const text = s.result.explanation;
    out.push(mkCheck(meta, "grounding", "scenario-labelled-hypothetical", /^Under "/.test(text) && s.result.description.length > 0 ? "pass" : "fail", "minor", { claimKind: "hypothetical", actual: text.slice(0, 60) }));
    const score = /health score (?:improves|worsens|is unchanged) by (\d+) point\(s\) to (\d+)\/100/.exec(text);
    if (score) {
      const wantScore = sc[`scenario${idx}.health.score`];
      const wantDelta = sc[`scenario${idx}.delta.health.score`];
      out.push(mkCheck(meta, "grounding", "claim:scenario-score", typeof wantScore === "number" && Number(score[2]) === wantScore ? "pass" : "fail", "major", { claimKind: "observed", expected: wantScore, actual: Number(score[2]), detail: "quoted scenario health score" }));
      out.push(mkCheck(meta, "grounding", "claim:scenario-score-delta", typeof wantDelta === "number" && Number(score[1]) === Math.abs(wantDelta) ? "pass" : "fail", "major", { claimKind: "observed", expected: wantDelta, actual: Number(score[1]), detail: "quoted change in health score" }));
    }
    const net = /net cash flow moves by ([+-]?\d+)/.exec(text);
    if (net) {
      const want = sc[`scenario${idx}.delta.cashflow.net`];
      out.push(mkCheck(meta, "grounding", "claim:scenario-net", typeof want === "number" && near(Number(net[1]), want, 0.5) ? "pass" : "fail", "major", { claimKind: "observed", expected: want, actual: Number(net[1]) }));
    }
    const sav = /savings rate shifts ([+-]?\d+\.\d) pts/.exec(text);
    if (sav) {
      const want = sc[`scenario${idx}.delta.cashflow.savingsRate`];
      out.push(mkCheck(meta, "grounding", "claim:scenario-savings", typeof want === "number" && near(Number(sav[1]), want * 100, 0.05) ? "pass" : "fail", "major", { claimKind: "observed", expected: typeof want === "number" ? want * 100 : want, actual: Number(sav[1]) }));
    }
  });
  return out;
}
