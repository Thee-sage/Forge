import { describe, expect, it } from "vitest";
import { analyzeFile, CurrencyMismatchError, reason, runAnalyses, simulate, totals, type AnalysisResult, type FinancialModel } from "../src/index.js";
import { makeHolding, makeModel, makeTxn, writeTempCsv } from "../src/testkit.js";
import { mulberry32 } from "./stats.js";
import { renderTransactionsCsv } from "./csv.js";
import { T, truth } from "./datasets/src/builders.js";
import type { AssetClass } from "../src/core/model.js";

/**
 * Phase 5: justified properties of the engine, checked over many seeded random models.
 * (The evaluator's own dataset checks these again on every case; these tests make them part of `npm test`.)
 */
const CLASSES: AssetClass[] = ["equity", "fixed_income", "cash", "real_estate", "commodity", "crypto", "alternative"];

function randomModel(seed: number, opts: { income?: boolean; holdings?: boolean } = {}): FinancialModel {
  const r = mulberry32(seed);
  const int = (lo: number, hi: number): number => lo + Math.floor(r() * (hi - lo + 1));
  const txns = [];
  const nMonths = int(1, 8);
  for (let m = 0; m < nMonths; m++) {
    const ym = `2024-${String(m + 1).padStart(2, "0")}`;
    if (opts.income !== false) txns.push(makeTxn(`${ym}-01`, int(1500, 9000) + int(0, 99) / 100, "salary"));
    for (let s = int(1, 6); s > 0; s--) txns.push(makeTxn(`${ym}-${String(int(2, 28)).padStart(2, "0")}`, -(int(3, 2500) + int(0, 99) / 100), ["groceries", "housing", "dining", "transport"][int(0, 3)]!));
  }
  const holdings = opts.holdings === false ? [] : Array.from({ length: int(1, 10) }, (_, i) => makeHolding(`H${i}`, int(50, 90000) + int(0, 99) / 100, CLASSES[int(0, CLASSES.length - 1)]!));
  return makeModel(txns, holdings);
}

const metric = (rs: AnalysisResult[], m: string, k: string): number | undefined => rs.find((r) => r.module === m)?.metrics.find((x) => x.key === k)?.value;
const SEEDS = Array.from({ length: 120 }, (_, i) => 1000 + i);

describe("accounting identities", () => {
  it("net cash flow equals the sum of signed transactions, inflow - outflow", () => {
    for (const seed of SEEDS) {
      const m = randomModel(seed);
      const a = runAnalyses(m);
      const signed = m.transactions.reduce((s, t) => s + (t.direction === "inflow" ? t.amount : -t.amount), 0);
      const net = metric(a, "cashflow", "net")!;
      expect(Math.abs(net - signed), `seed ${seed}`).toBeLessThan(1e-6);
      expect(Math.abs(net - (metric(a, "cashflow", "inflow")! - metric(a, "cashflow", "outflow")!))).toBeLessThan(1e-6);
      expect(totals(m).net).toBeCloseTo(net, 6);
    }
  });
  it("category spending sums to total outflow", () => {
    for (const seed of SEEDS) {
      const a = runAnalyses(randomModel(seed));
      const ex = a.find((r) => r.module === "expenditure")!;
      const cats = ex.evidence.reduce((s, e) => s + (e.value ?? 0), 0);
      // Evidence lists the top 10 categories; the pool here has only 4, so they are exhaustive.
      expect(Math.abs(cats - metric(a, "expenditure", "totalOutflow")!)).toBeLessThan(1e-6);
    }
  });
});

describe("portfolio mathematics", () => {
  it("class weights sum to 1; HHI in [1/n, 1]; effective positions = 1/HHI; top3 >= top1", () => {
    for (const seed of SEEDS) {
      const m = randomModel(seed, { holdings: true });
      const a = runAnalyses(m);
      const n = m.holdings.length;
      const weights = a.find((r) => r.module === "allocation")!.metrics.filter((x) => x.key.startsWith("weight_")).map((x) => x.value);
      expect(weights.reduce((s, x) => s + x, 0)).toBeCloseTo(1, 9);
      const hhi = metric(a, "concentration", "hhi")!;
      expect(hhi).toBeGreaterThanOrEqual(1 / n - 1e-12);
      expect(hhi).toBeLessThanOrEqual(1 + 1e-12);
      expect(metric(a, "concentration", "effectivePositions")!).toBeCloseTo(1 / hhi, 9);
      expect(metric(a, "concentration", "top3Weight")!).toBeGreaterThanOrEqual(metric(a, "concentration", "topWeight")! - 1e-12);
      const nonCash = m.holdings.filter((h) => h.assetClass !== "cash").length;
      if (nonCash > 0) {
        const risk = metric(a, "concentration", "riskHhi")!;
        expect(risk).toBeGreaterThanOrEqual(1 / nonCash - 1e-12);
        expect(risk).toBeLessThanOrEqual(1 + 1e-12);
      }
    }
  });
  it("a single holding has HHI exactly 1 and one effective position", () => {
    const a = runAnalyses(makeModel([], [makeHolding("ONLY", 123.45)]));
    expect(metric(a, "concentration", "hhi")).toBeCloseTo(1, 12);
    expect(metric(a, "concentration", "effectivePositions")).toBeCloseTo(1, 12);
  });
  it("n equal holdings have HHI 1/n", () => {
    for (const n of [2, 3, 5, 8, 13]) {
      const a = runAnalyses(makeModel([], Array.from({ length: n }, (_, i) => makeHolding(`E${i}`, 1000))));
      expect(metric(a, "concentration", "hhi")).toBeCloseTo(1 / n, 12);
    }
  });
});

describe("equivalent inputs give equivalent results", () => {
  const flat = (rs: AnalysisResult[]): Record<string, number> =>
    Object.fromEntries(rs.flatMap((r) => r.metrics.filter((m) => !m.key.startsWith("top") || r.module !== "expenditure").map((m) => [`${r.module}.${m.key}`, m.value] as const)));

  it("is invariant to the order of transactions and holdings", () => {
    for (const seed of SEEDS.slice(0, 60)) {
      const m = randomModel(seed);
      const flipped = { ...m, transactions: [...m.transactions].reverse(), holdings: [...m.holdings].reverse() };
      const a = flat(runAnalyses(m));
      const b = flat(runAnalyses(flipped));
      for (const k of Object.keys(a)) expect(b[k], `${k} seed ${seed}`).toBeCloseTo(a[k]!, 6);
    }
  });
  it("scaling every amount by k leaves ratios unchanged and scales currency amounts by k", () => {
    const k = 3;
    for (const seed of SEEDS.slice(0, 60)) {
      const m = randomModel(seed);
      const scaled: FinancialModel = {
        ...m,
        transactions: m.transactions.map((t) => ({ ...t, amount: t.amount * k })),
        holdings: m.holdings.map((h) => ({ ...h, value: h.value * k, price: h.price * k })),
      };
      const a = runAnalyses(m);
      const b = runAnalyses(scaled);
      for (const [mod, key] of [["cashflow", "savingsRate"], ["concentration", "hhi"], ["concentration", "riskHhi"], ["health", "runwayMonths"], ["allocation", "cashWeight"], ["anomaly", "anomalies"]] as const) {
        const x = metric(a, mod, key);
        const y = metric(b, mod, key);
        if (x === undefined) expect(y).toBeUndefined();
        else expect(y!, `${mod}.${key} seed ${seed}`).toBeCloseTo(x, 8);
      }
      expect(metric(b, "cashflow", "net")!).toBeCloseTo(metric(a, "cashflow", "net")! * k, 5);
      const sa = metric(a, "health", "score");
      const sb = metric(b, "health", "score");
      if (sa !== undefined) expect(Math.abs(sb! - sa)).toBeLessThanOrEqual(1); // +-1 only if a score sits on a .5 rounding boundary
    }
  });
  it("splitting one transaction into two with the same date and category does not change totals", () => {
    const m = randomModel(7);
    const t = m.transactions.find((x) => x.direction === "outflow")!;
    const split: FinancialModel = {
      ...m,
      transactions: m.transactions.flatMap((x) => (x === t ? [{ ...x, id: "a", amount: x.amount / 4 }, { ...x, id: "b", amount: (x.amount * 3) / 4 }] : [x])),
    };
    const a = runAnalyses(m);
    const b = runAnalyses(split);
    for (const key of ["inflow", "outflow", "net", "savingsRate", "avgMonthlyNet"]) expect(metric(b, "cashflow", key)!).toBeCloseTo(metric(a, "cashflow", key)!, 6);
    expect(metric(b, "expenditure", "totalOutflow")!).toBeCloseTo(metric(a, "expenditure", "totalOutflow")!, 6);
  });
  it("the same ledger written in different CSV layouts yields identical metrics", () => {
    const t = truth(T(
      "2024-01-25 +12500.25 salary Pay", "2024-01-29 -1700.35 housing Rent", "2024-02-25 +12500.25 salary Pay", "2024-02-27 -2088.88 dining Dinner", "2024-03-15 -45.50 transport Metro",
    ));
    const results = [
      { amountFormat: "signed", dateFormat: "iso" }, { amountFormat: "parens", dateFormat: "iso" }, { amountFormat: "debitcredit", dateFormat: "dmy" },
      { amountFormat: "symbol", dateFormat: "long" }, { amountFormat: "signed", dateFormat: "mdy" },
    ].map((input) => {
      const p = writeTempCsv("t.csv", renderTransactionsCsv(t, input as never));
      return flat(analyzeFile(p).analyses);
    });
    for (const r of results.slice(1)) for (const k of Object.keys(results[0]!)) expect(r[k], k).toBeCloseTo(results[0]![k]!, 9);
  });
});

describe("scenario properties", () => {
  it("a baseline scenario reproduces the baseline and never mutates the model", () => {
    for (const seed of SEEDS.slice(0, 60)) {
      const m = randomModel(seed);
      const before = JSON.stringify(m);
      const base = runAnalyses(m);
      const r = simulate(m, {}, base);
      expect(r.deltas.every((d) => d.delta === 0), `seed ${seed}`).toBe(true);
      expect(JSON.stringify(r.scenarioResults)).toBe(JSON.stringify(base));
      simulate(m, { incomePct: -0.3, expensePct: 0.2, recurringExpense: { amount: 77, category: "x" }, oneOffExpense: { amount: 500, category: "x" } });
      expect(JSON.stringify(m)).toBe(before);
    }
  });
  it("income +x% and expenses -y% never lowers net cash flow", () => {
    for (const seed of SEEDS.slice(0, 40)) {
      const m = randomModel(seed);
      const r = simulate(m, { incomePct: 0.1, expensePct: -0.1 });
      expect(r.deltas.find((d) => d.key === "cashflow.net")!.delta).toBeGreaterThanOrEqual(-1e-9);
    }
  });
});

describe("data safety properties", () => {
  it("mixing currencies can never produce a total: analysis refuses", () => {
    for (const seed of SEEDS.slice(0, 40)) {
      const m = randomModel(seed);
      const mixed = { ...m, transactions: m.transactions.map((t, i) => (i === 0 ? { ...t, currency: "EUR" } : t)) };
      expect(() => runAnalyses(mixed)).toThrow(CurrencyMismatchError);
    }
  });
  it("unsupported metrics are not fabricated when their inputs are absent", () => {
    for (const seed of SEEDS.slice(0, 40)) {
      const noIncome = runAnalyses(randomModel(seed, { income: false }));
      expect(metric(noIncome, "health", "score"), `score without income, seed ${seed}`).toBeUndefined();
      const noHoldings = runAnalyses(randomModel(seed, { holdings: false }));
      expect(metric(noHoldings, "health", "runwayMonths")).toBeUndefined();
      expect(metric(noHoldings, "health", "diversificationScore")).toBeUndefined();
    }
  });
  it("every emitted insight has valid, relevant, traceable evidence", () => {
    let insights = 0;
    for (const seed of SEEDS) {
      const m = randomModel(seed);
      const a = runAnalyses(m);
      const ins = reason(m, a);
      const ids = ins.map((i) => i.ruleId);
      expect(new Set(ids).size).toBe(ids.length);
      for (const i of ins) {
        insights += 1;
        expect(i.evidence.length).toBeGreaterThan(0);
        expect(i.basis.length).toBeGreaterThan(0);
        expect(i.confidence).toBeGreaterThanOrEqual(0);
        expect(i.confidence).toBeLessThanOrEqual(1);
        for (const e of i.evidence) {
          expect(e.module, `${i.ruleId} evidence module`).toBeDefined();
          expect(i.basis).toContain(e.module);
          const published = a.find((r) => r.module === e.module)!;
          const found = [...published.evidence, ...published.findings.flatMap((f) => f.evidence)].some((x) => x.label === e.label && x.detail === e.detail);
          expect(found, `${i.ruleId}: ${e.module}/${e.label} not published by the module`).toBe(true);
        }
      }
    }
    expect(insights).toBeGreaterThan(50);
  });
  it("never emits NaN or Infinity anywhere in a report", () => {
    for (const seed of SEEDS) {
      const a = runAnalyses(randomModel(seed));
      for (const r of a) for (const m of r.metrics) expect(Number.isFinite(m.value), `${r.module}.${m.key}`).toBe(true);
    }
  });
});
