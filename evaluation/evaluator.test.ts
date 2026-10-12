import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { tolerance } from "./metrics.js";
import { computeExpected } from "./oracle/oracle.js";
import { Rat } from "./rational.js";
import { compare } from "./runner/numeric.js";
import { bootstrapF1, wilson } from "./stats.js";
import type { Dataset } from "./types.js";
import { DATASET_VERSION } from "./version.js";
import { H, T, truth } from "./datasets/src/builders.js";

const here = dirname(fileURLToPath(import.meta.url));
const load = (split: string): { text: string; ds: Dataset } => {
  const text = readFileSync(join(here, "datasets", split, "dataset.json"), "utf8");
  return { text, ds: JSON.parse(text) as Dataset };
};
const meta = { id: "t", split: "dev" as const, family: "t", ambiguous: false };

describe("oracle is checked against hand calculations", () => {
  it("every dataset case that carries hand-calculated values agrees with the oracle", () => {
    let checked = 0;
    for (const split of ["dev", "heldout"]) {
      for (const c of load(split).ds.pipeline) {
        if (!c.hand) continue;
        const exp = computeExpected(c.truth);
        for (const [key, want] of Object.entries(c.hand)) {
          const got = exp.values[key];
          expect(typeof got, `${c.id} ${key}`).toBe("number");
          expect(Math.abs((got as number) - want), `${c.id} ${key}: oracle ${got} vs hand ${want}`).toBeLessThanOrEqual(1e-9 + 1e-12 * Math.abs(want));
          checked += 1;
        }
      }
    }
    expect(checked).toBeGreaterThan(30);
  });

  it("worked health example: runway 2.0, liquidity 1/3, diversification 2/3, score 83", () => {
    // Two months, income 1000, spend 500 each; holdings cash 1000 + equity 1000.
    // savings 1, expense 1, stability 1, liquidity (1000/500)/6 = 1/3, diversification (1-0.5)/0.75 = 2/3.
    // weighted: 0.30 + 0.15 + 0.20 + 0.15/3 + 0.20*2/3 = 0.83333 -> 83.
    const t = truth(T("2024-01-02 +1000 salary A", "2024-01-09 -500 housing B", "2024-02-02 +1000 salary C", "2024-02-09 -500 housing D"), H("C 1000 cash", "E 1000 equity"));
    const v = computeExpected(t).values;
    expect(v["health.runwayMonths"]).toBeCloseTo(2, 12);
    expect(v["health.liquidityScore"]).toBeCloseTo(1 / 3, 12);
    expect(v["health.diversificationScore"]).toBeCloseTo(2 / 3, 12);
    expect(v["health.score"]).toBe(83);
    expect(v["concentration.hhi"]).toBeCloseTo(0.5, 12);
    expect(v["concentration.effectivePositions"]).toBeCloseTo(2, 12);
  });

  it("worked cap example: net below zero caps a score that would otherwise be 51 at 45", () => {
    // Five months net +100, one month net -2000 => net -1500. savings 0, expense 0, stability 5/6, liquidity 1, diversification 0.96:
    // raw = 0.2*(5/6) + 0.15 + 0.2*0.96 = 0.50867 -> 51, capped to 45.
    const ls = ["01", "02", "03", "04", "05"].flatMap((m) => [`2024-${m}-01 +1000 salary A`, `2024-${m}-05 -900 housing B`]);
    const t = truth(T(...ls, "2024-06-01 +1000 salary C", "2024-06-05 -3000 housing D"), H("C 100000 cash", "E 50000 equity", "F 50000 equity", "G 50000 fixed_income"));
    expect(computeExpected(t).values["health.score"]).toBe(45);
  });

  it("undefined measures are null, not 0", () => {
    const v = computeExpected(truth(T("2024-01-02 -10 misc A"))).values;
    expect(v["cashflow.savingsRate"]).toBeNull();
    expect(v["health.score"]).toBeNull();
    expect(v["concentration.hhi"]).toBeNull();
  });

  it("modest deviations are not flagged (exact rational z)", () => {
    // variable amounts 10,11,12,13,... : craft a point exactly at the boundary (z = 3.5 is NOT > 3.5).
    // med=12, MAD=1 for [10,11,12,13,14]; z(x) = 0.6745*(x-12)/1 ; 3.5/0.6745 = 5.1890...
    const t = truth(T("2024-01-01 +9999 salary S", "2024-01-02 -10 a a1", "2024-01-03 -11 a a2", "2024-01-04 -12 a a3", "2024-01-05 -13 a a4", "2024-01-06 -14 a a5", "2024-01-07 -17.18 a big", "2024-01-08 -17.19 a bigger"));
    // med of [10,11,12,13,14,17.18,17.19] = 13; MAD = median(|x-13|)= median[3,2,1,0,1,4.18,4.19] = 2 ; z(17.18)=0.6745*4.18/2=1.41 -> none flagged
    expect(computeExpected(t).extras.anomalyFlags).toEqual([]);
  });
});

describe("the evaluator cannot hide meaningful errors", () => {
  it("a one-cent error on a total fails; float noise passes", () => {
    expect(compare(meta, "cashflow.net", 1234.56, 1234.57, false).status).toBe("fail");
    expect(compare(meta, "cashflow.net", 1234.56, 1234.56 + 1e-9, false).status).toBe("pass");
    expect(compare(meta, "cashflow.net", 1e9, 1e9 + 0.01, false).status).toBe("fail");
  });
  it("a wrong 4th decimal of a ratio fails", () => {
    expect(compare(meta, "cashflow.savingsRate", 0.6101, 0.6102, false).status).toBe("fail");
  });
  it("scores and counts are exact", () => {
    expect(compare(meta, "health.score", 83, 84, false).status).toBe("fail");
    expect(compare(meta, "health.score", 83, 84, false).severity).toBe("minor");
    expect(compare(meta, "expenditure.categories", 4, 5, false).status).toBe("fail");
  });
  it("a number where the measure is undefined fails; an explained zero or absence passes", () => {
    expect(compare(meta, "cashflow.savingsRate", null, 0, false).status).toBe("fail");
    expect(compare(meta, "cashflow.savingsRate", null, 0, true).status).toBe("pass");
    expect(compare(meta, "cashflow.savingsRate", null, undefined, false).status).toBe("pass");
    expect(compare(meta, "cashflow.savingsRate", null, 0.3, true).status).toBe("fail");
  });
  it("non-finite output is a critical failure", () => {
    const c = compare(meta, "cashflow.net", 1, Number.POSITIVE_INFINITY, false);
    expect(c.status).toBe("fail");
    expect(c.severity).toBe("critical");
  });
  it("tolerances are far below one cent", () => {
    expect(tolerance("currency", 1e7)).toBeLessThan(0.001);
  });
});

describe("statistics", () => {
  it("Wilson interval matches known values", () => {
    const z = wilson(0, 10);
    expect(z.lower).toBe(0);
    expect(z.upper).toBeCloseTo(0.2775, 3);
    const h = wilson(50, 100);
    expect(h.lower).toBeCloseTo(0.4038, 3);
    expect(h.upper).toBeCloseTo(0.5962, 3);
    const all = wilson(20, 20);
    expect(all.upper).toBeCloseTo(1, 12);
    expect(all.lower).toBeCloseTo(0.8389, 3);
  });
  it("bootstrap F1 is reproducible", () => {
    const items = ["tp", "tp", "fp", "fn", "tn", "tp", "tn"] as const;
    expect(bootstrapF1([...items], 7, 300)).toEqual(bootstrapF1([...items], 7, 300));
  });
  it("Rat is exact where doubles are not", () => {
    const x = Rat.dec("0.1").add(Rat.dec("0.2"));
    expect(x.eq(Rat.dec("0.3"))).toBe(true);
    expect(0.1 + 0.2).not.toBe(0.3);
  });
});

describe("leakage and independence controls", () => {
  it("both datasets match the frozen MANIFEST (held-out unchanged since freezing)", () => {
    const manifest = JSON.parse(readFileSync(join(here, "datasets", "MANIFEST.json"), "utf8")) as { datasetVersion: string; files: Record<string, { sha256: string }> };
    expect(manifest.datasetVersion).toBe(DATASET_VERSION);
    for (const split of ["dev", "heldout"]) {
      const { text } = load(split);
      expect(createHash("sha256").update(text).digest("hex"), `${split} dataset.json was modified after freezing`).toBe(manifest.files[`${split}/dataset.json`]!.sha256);
    }
  });
  it("dev and held-out share no case ids and no identical transaction sets", () => {
    const dev = load("dev").ds;
    const held = load("heldout").ds;
    const ids = new Set(dev.pipeline.map((c) => c.id));
    expect(held.pipeline.some((c) => ids.has(c.id))).toBe(false);
    const sig = (c: Dataset["pipeline"][number]): string => JSON.stringify([c.truth.txns, c.truth.holdings]);
    const devSigs = new Set(dev.pipeline.map(sig));
    expect(held.pipeline.filter((c) => c.truth.txns.length + c.truth.holdings.length > 0 && devSigs.has(sig(c))).map((c) => c.id)).toEqual([]);
    const devText = new Set([...dev.cells.map((c) => `${c.kind}|${c.raw}`), ...dev.classify.map((c) => `${c.kind}|${c.text}`)]);
    expect([...held.cells.map((c) => `${c.kind}|${c.raw}`), ...held.classify.map((c) => `${c.kind}|${c.text}`)].filter((s) => devText.has(s))).toEqual([]);
  });
  it("the oracle, renderer and dataset sources import nothing from src/ (independence)", () => {
    const files: string[] = [];
    const walk = (d: string): void => {
      for (const e of readdirSync(d)) {
        const p = join(d, e);
        if (statSync(p).isDirectory()) {
          if (e === "runner" || e === "results" || e === "dev" || e === "heldout") continue;
          walk(p);
        } else if (p.endsWith(".ts") && !p.endsWith(".test.ts") && !/[\\/]run\.ts$/.test(p) && !/[\\/]markdown\.ts$/.test(p) && !/[\\/]summary\.ts$/.test(p)) files.push(p);
      }
    };
    walk(here);
    expect(files.length).toBeGreaterThan(8);
    for (const f of files) {
      expect(readFileSync(f, "utf8"), `${f} must not import production code`).not.toMatch(/from\s+["'](?:\.\.?\/)+src\//);
    }
  });
});
