/**
 * Independent numerical oracle.
 *
 * Every function here is an exact-arithmetic (BigInt rational) implementation of a metric as
 * DEFINED in docs/ALGORITHM_REFERENCE.md. It imports nothing from src/ (enforced by
 * evaluation/independence.test.ts), so a bug in Forge's float code cannot also be in here.
 *
 * Return convention for `values`:
 *   number    the exact value, converted to a double only at the very end
 *   null      the measure is mathematically undefined for this input; Forge must report it as
 *             unavailable (absent, or an explained zero) rather than a number
 *   (missing) the metric is not compared for this case (documented ambiguity / not applicable)
 */
import { Rat, ZERO, ONE, sumRat, clampRat, medianRat } from "../rational.js";
import type { ScenarioJson, Truth } from "../types.js";

export interface L { date: string; amt: Rat; category: string; description: string }
export interface P { symbol: string; value: Rat; cls: string }

export type Values = Record<string, number | null>;

export interface Extras {
  /** Per active month: inflow / outflow / net (numbers). */
  monthly: { month: string; inflow: number; outflow: number; net: number }[];
  categoryTotals: Record<string, number>;
  /** Per-category monthly average spend in the earlier / recent half of active months (needs >= 2 active months). */
  trend: Record<string, { early: number; recent: number }>;
  /** Mean monthly net of the earlier / recent half of active months. */
  halfNets: { earlier: number; recent: number } | null;
  /** Per-row holding values and weights (a symbol held twice appears twice). */
  rowValues: number[];
  rowWeights: number[];
  holdingValues: Record<string, number>;
  holdingWeights: Record<string, number>;
  classValues: Record<string, number>;
  /** Index into truth.txns of outflows flagged by the documented rule; null when the rule is undefined (MAD = 0). */
  anomalyFlags: number[] | null;
  outflowIndices: number[];
  /** Every scalar quantity a correct explanation could cite (for prose-claim verification). */
  universe: number[];
}

export interface ScenarioExpected { values: Values }
export interface Expected { values: Values; extras: Extras; scenarios: ScenarioExpected[] }

const n = (r: Rat): number => r.toNumber();
const R = (s: string): Rat => Rat.dec(s);

export function ledgerOf(truth: Truth): L[] {
  return truth.txns.map((t) => ({ date: t.date, amt: R(t.amount), category: t.category.trim().toLowerCase(), description: t.description }));
}
export function portfolioOf(truth: Truth): P[] {
  return truth.holdings.map((h) => ({ symbol: h.symbol, value: R(h.value), cls: h.assetClass }));
}

/** Inclusive count of calendar months between the earliest and latest date (minimum 1). */
export function calendarMonths(ls: L[]): number {
  if (ls.length === 0) return 1;
  const ds = ls.map((l) => l.date).sort();
  const [sy, sm] = ds[0]!.split("-").map(Number) as [number, number];
  const [ey, em] = ds[ds.length - 1]!.split("-").map(Number) as [number, number];
  return Math.max(1, (ey - sy) * 12 + (em - sm) + 1);
}

interface Month { month: string; inflow: Rat; outflow: Rat; net: Rat }
function months(ls: L[]): Month[] {
  const m = new Map<string, Month>();
  for (const l of ls) {
    const k = l.date.slice(0, 7);
    const b = m.get(k) ?? { month: k, inflow: ZERO, outflow: ZERO, net: ZERO };
    if (l.amt.gt(ZERO)) b.inflow = b.inflow.add(l.amt);
    else b.outflow = b.outflow.add(l.amt.neg());
    b.net = b.inflow.sub(b.outflow);
    m.set(k, b);
  }
  return [...m.values()].sort((a, b) => a.month.localeCompare(b.month));
}

const cashClass = "cash";
const W = { savings: R("0.3"), expense: R("0.15"), stability: R("0.2"), liquidity: R("0.15"), diversification: R("0.2") };

interface Computed { values: Values; flags: number[] | null; mon: Month[]; cat: Map<string, Rat>; trend: Record<string, { early: number; recent: number }>; halfNets: { earlier: number; recent: number } | null }

/** Compute every ledger+portfolio metric for one (possibly scenario-transformed) state. */
function compute(ls: L[], ps: P[]): Computed {
  const v: Values = {};
  const inflow = sumRat(ls.filter((l) => l.amt.gt(ZERO)).map((l) => l.amt));
  const outflow = sumRat(ls.filter((l) => l.amt.lt(ZERO)).map((l) => l.amt.neg()));
  const net = inflow.sub(outflow);
  const mon = months(ls);
  const calM = calendarMonths(ls);
  const trend: Record<string, { early: number; recent: number }> = {};
  let halfNets: { earlier: number; recent: number } | null = null;

  // ---- cashflow -----------------------------------------------------------------------
  v["cashflow.inflow"] = n(inflow);
  v["cashflow.outflow"] = n(outflow);
  v["cashflow.net"] = n(net);
  v["cashflow.savingsRate"] = inflow.isZero() ? null : n(net.div(inflow));
  v["cashflow.avgMonthlyNet"] = n(net.div(Rat.int(calM)));
  v["cashflow.months"] = calM;
  if (mon.length >= 2) {
    const mid = Math.floor(mon.length / 2);
    const avg = (xs: Month[]): Rat => sumRat(xs.map((x) => x.net)).div(Rat.int(xs.length));
    const first = avg(mon.slice(0, mid));
    const second = avg(mon.slice(mid));
    halfNets = { earlier: n(first), recent: n(second) };
    if (!first.isZero()) v["cashflow.trendSlope"] = n(second.sub(first).div(first.abs()));
  }

  // ---- expenditure --------------------------------------------------------------------
  const cat = new Map<string, Rat>();
  for (const l of ls) if (l.amt.lt(ZERO)) cat.set(l.category, (cat.get(l.category) ?? ZERO).add(l.amt.neg()));
  const ranked = [...cat.entries()].sort((a, b) => b[1].cmp(a[1]));
  v["expenditure.totalOutflow"] = n(outflow);
  v["expenditure.categories"] = ranked.length;
  // Ranking is only well-defined when no two of the top six categories tie.
  const tieInTop = ranked.slice(0, 6).some((e, i, a) => i > 0 && a[i - 1]![1].eq(e[1]));
  if (!tieInTop) {
    ranked.slice(0, 5).forEach((e, i) => {
      v[`expenditure.top${i + 1}_amount`] = n(e[1]);
      if (!outflow.isZero()) v[`expenditure.top${i + 1}_share`] = n(e[1].div(outflow));
    });
  }

  // ---- trend (per-category monthly averages, earlier vs recent half of ACTIVE months) --
  if (mon.length < 2) {
    v["trend.categoriesChanged"] = null;
    v["trend.biggestRise"] = null;
    v["trend.biggestDrop"] = null;
  } else {
    const mid = Math.floor(mon.length / 2);
    const early = new Set(mon.slice(0, mid).map((m) => m.month));
    const eN = Rat.int(mid);
    const rN = Rat.int(mon.length - mid);
    const e = new Map<string, Rat>();
    const r = new Map<string, Rat>();
    for (const l of ls) {
      if (!l.amt.lt(ZERO)) continue;
      const bucket = early.has(l.date.slice(0, 7)) ? e : r;
      bucket.set(l.category, (bucket.get(l.category) ?? ZERO).add(l.amt.neg()));
    }
    const cats = new Set([...e.keys(), ...r.keys()]);
    cats.forEach((cname) => (trend[cname] = { early: n((e.get(cname) ?? ZERO).div(eN)), recent: n((r.get(cname) ?? ZERO).div(rN)) }));
    const deltas = [...cats].map((c) => (r.get(c) ?? ZERO).div(rN).sub((e.get(c) ?? ZERO).div(eN))).filter((d) => !d.isZero());
    v["trend.categoriesChanged"] = deltas.length;
    v["trend.biggestRise"] = n(deltas.filter((d) => d.gt(ZERO)).reduce((a, b) => (b.gt(a) ? b : a), ZERO));
    v["trend.biggestDrop"] = n(deltas.filter((d) => d.lt(ZERO)).reduce((a, b) => (b.lt(a) ? b : a), ZERO));
  }

  // ---- anomaly ------------------------------------------------------------------------
  const outIdx = ls.map((l, i) => (l.amt.lt(ZERO) ? i : -1)).filter((i) => i >= 0);
  let flags: number[] | null = [];
  if (outIdx.length < 5) {
    v["anomaly.medianOutflow"] = null;
    v["anomaly.largest"] = null;
    flags = [];
  } else {
    const key = (i: number): string => ls[i]!.amt.neg().mul(Rat.int(100)).roundHalfUp().toString();
    const counts = new Map<string, number>();
    outIdx.forEach((i) => counts.set(key(i), (counts.get(key(i)) ?? 0) + 1));
    const variable = outIdx.filter((i) => (counts.get(key(i)) ?? 0) < 3);
    v["anomaly.largest"] = n(outIdx.map((i) => ls[i]!.amt.neg()).reduce((a, b) => (b.gt(a) ? b : a), ZERO));
    if (variable.length === 0) {
      flags = [];
    } else {
      const amts = variable.map((i) => ls[i]!.amt.neg());
      const med = medianRat(amts);
      v["anomaly.medianOutflow"] = n(med);
      const mad = medianRat(amts.map((a) => a.sub(med).abs()));
      if (mad.isZero()) {
        flags = null; // documented rule undefined at MAD = 0
      } else {
        // modified z = 0.6745 (x - med) / MAD > 3.5   (exact: 6745/10000 and 7/2)
        flags = variable.filter((i) => R("0.6745").mul(ls[i]!.amt.neg().sub(med)).gt(R("3.5").mul(mad)));
      }
    }
  }

  // ---- portfolio ----------------------------------------------------------------------
  const total = sumRat(ps.map((p) => p.value));
  const cash = sumRat(ps.filter((p) => p.cls === cashClass).map((p) => p.value));
  v["allocation.portfolioValue"] = n(total);
  let hhi: Rat | undefined;
  if (ps.length === 0) {
    v["allocation.assetClasses"] = null;
    v["allocation.cashWeight"] = null;
    v["concentration.hhi"] = null;
    v["concentration.riskHhi"] = null;
    v["concentration.effectivePositions"] = null;
  } else {
    const byClass = new Map<string, Rat>();
    ps.forEach((p) => byClass.set(p.cls, (byClass.get(p.cls) ?? ZERO).add(p.value)));
    v["allocation.assetClasses"] = byClass.size;
    v["allocation.cashWeight"] = n(cash.div(total));
    byClass.forEach((val, c) => (v[`allocation.weight_${c}`] = n(val.div(total))));
    const w = ps.map((p) => p.value.div(total)).sort((a, b) => b.cmp(a));
    hhi = sumRat(w.map((x) => x.mul(x)));
    v["concentration.hhi"] = n(hhi);
    v["concentration.effectivePositions"] = n(ONE.div(hhi));
    v["concentration.topWeight"] = n(w[0]!);
    v["concentration.top3Weight"] = n(sumRat(w.slice(0, 3)));
    v["concentration.positions"] = ps.length;
    const nc = ps.filter((p) => p.cls !== cashClass);
    const ncTotal = sumRat(nc.map((p) => p.value));
    if (nc.length === 0) {
      v["concentration.riskHhi"] = null;
      v["concentration.topNonCashWeight"] = 0;
    } else {
      v["concentration.riskHhi"] = n(sumRat(nc.map((p) => p.value.div(ncTotal).mul(p.value.div(ncTotal)))));
      v["concentration.topNonCashWeight"] = n(nc.map((p) => p.value.div(total)).reduce((a, b) => (b.gt(a) ? b : a), ZERO));
    }
  }

  // ---- health (D8) --------------------------------------------------------------------
  const dims: { w: Rat; s: Rat }[] = [];
  const hasIncome = inflow.gt(ZERO);
  let runway: Rat | undefined;
  if (hasIncome) {
    const sr = net.div(inflow);
    const er = outflow.div(inflow);
    const sav = clampRat(sr.div(R("0.2")), ZERO, ONE);
    const exp = clampRat(ONE.sub(er.sub(R("0.5")).div(R("0.5"))), ZERO, ONE);
    v["health.savingsScore"] = n(sav);
    v["health.expenseScore"] = n(exp);
    dims.push({ w: W.savings, s: sav }, { w: W.expense, s: exp });
  } else {
    v["health.savingsScore"] = null;
    v["health.expenseScore"] = null;
  }
  let posShare: Rat | undefined;
  if (mon.length >= 2) {
    posShare = Rat.int(mon.filter((m) => !m.net.lt(ZERO)).length).div(Rat.int(mon.length));
    v["health.stabilityScore"] = n(posShare);
    dims.push({ w: W.stability, s: posShare });
  } else v["health.stabilityScore"] = null;
  if (ps.length > 0 && outflow.gt(ZERO)) {
    runway = cash.div(outflow.div(Rat.int(calM)));
    const liq = clampRat(runway.div(Rat.int(6)), ZERO, ONE);
    v["health.runwayMonths"] = n(runway);
    v["health.liquidityScore"] = n(liq);
    dims.push({ w: W.liquidity, s: liq });
  } else {
    v["health.runwayMonths"] = null;
    v["health.liquidityScore"] = null;
  }
  if (ps.length > 0 && hhi !== undefined) {
    const div = clampRat(ONE.sub(hhi).div(R("0.75")), ZERO, ONE);
    v["health.diversificationScore"] = n(div);
    dims.push({ w: W.diversification, s: div });
  } else v["health.diversificationScore"] = null;
  v["health.assessedDimensions"] = dims.length;
  if (!hasIncome) {
    v["health.score"] = null;
  } else {
    const raw = sumRat(dims.map((d) => d.w.mul(d.s))).div(sumRat(dims.map((d) => d.w)));
    let cap = 100n;
    if (net.lt(ZERO)) cap = 45n;
    if (runway !== undefined && runway.lt(ONE) && cap > 55n) cap = 55n;
    // Documented rule (D8): "majority of months cash-flow negative" = strictly more than half.
    if (mon.length >= 2 && mon.filter((m) => m.net.lt(ZERO)).length * 2 > mon.length && cap > 55n) cap = 55n;
    const rounded = raw.mul(Rat.int(100)).roundHalfUp();
    v["health.score"] = Number(rounded < cap ? rounded : cap);
    // Until D21 the implementation applied this cap only when fewer than 34% of months were
    // non-negative, so the oracle modelled both readings and marked any score they disagreed
    // on as interpretation-dependent. D21 settled the question in favour of the documented
    // majority rule and the code now implements it, so there is one reading and the score is
    // scored outright. Removing the marking widens A3's denominator; it does not relax a check.
  }
  return { values: v, flags, mon, cat, trend, halfNets };
}

function applyScenario(ls: L[], s: ScenarioJson): L[] {
  const inc = s.incomePct ? ONE.add(R(s.incomePct)) : ONE;
  const exp = s.expensePct ? ONE.add(R(s.expensePct)) : ONE;
  const out: L[] = ls.map((l) => ({ ...l, amt: l.amt.gt(ZERO) ? l.amt.mul(inc) : l.amt.mul(exp) }));
  if (s.recurringExpense && R(s.recurringExpense.amount).gt(ZERO)) {
    // "one new recurring expense per covered month" - months that contain data (documented in simulate.ts).
    for (const m of months(ls)) {
      out.push({ date: `${m.month}-15`, amt: R(s.recurringExpense.amount).neg(), category: s.recurringExpense.category.toLowerCase(), description: "scenario" });
    }
  }
  if (s.oneOffExpense && R(s.oneOffExpense.amount).gt(ZERO)) {
    const end = ls.map((l) => l.date).sort().pop() ?? "1970-01-01";
    out.push({ date: end, amt: R(s.oneOffExpense.amount).neg(), category: s.oneOffExpense.category.toLowerCase(), description: "scenario" });
  }
  return out;
}

const TRACKED = ["cashflow.net", "cashflow.savingsRate", "cashflow.avgMonthlyNet", "health.score", "health.runwayMonths"];

export function computeExpected(truth: Truth, scenarios: ScenarioJson[] = []): Expected {
  const ls = ledgerOf(truth);
  const ps = portfolioOf(truth);
  const base = compute(ls, ps);

  const scen: ScenarioExpected[] = scenarios.map((s, idx) => {
    const sc = compute(applyScenario(ls, s), ps);
    const values: Values = {};
    for (const key of TRACKED) {
      const b = base.values[key];
      const a = sc.values[key];
      values[`scenario${idx}.${key}`] = a === undefined ? null : a;
      // A delta exists only when BOTH sides are defined numbers; otherwise it must not be fabricated.
      values[`scenario${idx}.delta.${key}`] = typeof a === "number" && typeof b === "number" ? a - b : null;
    }
    return { values };
  });

  const monthly = base.mon.map((m) => ({ month: m.month, inflow: n(m.inflow), outflow: n(m.outflow), net: n(m.net) }));
  const categoryTotals: Record<string, number> = {};
  base.cat.forEach((val, c) => (categoryTotals[c] = n(val)));
  const total = sumRat(ps.map((p) => p.value));
  const holdingValues: Record<string, number> = {};
  const holdingWeights: Record<string, number> = {};
  const classValues: Record<string, number> = {};
  ps.forEach((p) => {
    holdingValues[p.symbol] = (holdingValues[p.symbol] ?? 0) + n(p.value);
    holdingWeights[p.symbol] = n(p.value.div(total));
    classValues[p.cls] = (classValues[p.cls] ?? 0) + n(p.value);
  });
  const outflowIndices = ls.map((l, i) => (l.amt.lt(ZERO) ? i : -1)).filter((i) => i >= 0);

  const universe: number[] = [];
  for (const val of Object.values(base.values)) if (typeof val === "number") universe.push(val);
  universe.push(...ps.map((p) => n(p.value)), ...ps.map((p) => n(p.value.div(total))), ...Object.values(categoryTotals), ...Object.values(holdingValues), ...Object.values(holdingWeights), ...Object.values(classValues));
  monthly.forEach((m) => universe.push(m.inflow, m.outflow, m.net));
  ls.forEach((l) => universe.push(n(l.amt.abs())));

  return {
    values: base.values,
    extras: { rowValues: ps.map((p) => n(p.value)), rowWeights: ps.map((p) => n(p.value.div(total))), monthly, categoryTotals, trend: base.trend, halfNets: base.halfNets, holdingValues, holdingWeights, classValues, anomalyFlags: base.flags, outflowIndices, universe },
    scenarios: scen,
  };
}
