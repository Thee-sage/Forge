import { describe, it, expect } from "vitest";
import { runAnalyses } from "./index.js";
import { findMetric } from "../core/result.js";
import { makeHolding, makeModel, makeTxn } from "../testkit.js";

/**
 * Regression tests for the behavioural decisions taken in the session-5 audit
 * (docs/DECISIONS.md D21-D23, docs/ALGORITHM_REFERENCE.md §4.1 and §6). Each `it` below was
 * verified to fail on commit cc9d6a9, the state immediately before the fixes.
 */

const moduleOf = (txns: ReturnType<typeof makeTxn>[], mod: string, holdings: ReturnType<typeof makeHolding>[] = []) =>
  runAnalyses(makeModel(txns, holdings)).find((r) => r.module === mod)!;

const score = (txns: ReturnType<typeof makeTxn>[], holdings: ReturnType<typeof makeHolding>[] = []) =>
  findMetric(runAnalyses(makeModel(txns, holdings)), "health", "score");

describe("health-score cap at a strict majority of negative months (D21)", () => {
  /**
   * Seven months, four negative: a majority, but 3/7 = 42.9% non-negative, so the old
   * `positiveShare < 0.34` test did not cap. The profile is otherwise strong — a 38% savings
   * rate, nearly eleven months of runway, a diversified portfolio — so without the cap it
   * scores in the high seventies despite being in deficit most months. That is exactly the
   * "a critical weakness cannot hide behind strong dimensions" case D8 describes, so an
   * uncapped score here is the defect, and a weaker profile would make this test vacuous.
   */
  const fourOfSevenNegative = [
    ...[1, 2, 3].flatMap((m) => [
      makeTxn(`2024-0${m}-01`, 6000, "salary"),
      makeTxn(`2024-0${m}-05`, -500, "housing"),
    ]),
    ...[4, 5, 6, 7].flatMap((m) => [
      makeTxn(`2024-0${m}-01`, 6000, "salary"),
      makeTxn(`2024-0${m}-05`, -6100, "housing"),
    ]),
  ];
  const holdings = [
    makeHolding("CASH", 40000, "cash"),
    makeHolding("EQ", 40000, "equity"),
    makeHolding("BOND", 40000, "fixed_income"),
  ];

  it("caps at 55 when four of seven months are negative", () => {
    const health = moduleOf(fourOfSevenNegative, "health", holdings);
    expect(health.findings.some((f) => /capped at 55/.test(f.message))).toBe(true);
    expect(score(fourOfSevenNegative, holdings)).toBe(55);
  });

  it("names the negative month count, not the positive one, in the reason", () => {
    const health = moduleOf(fourOfSevenNegative, "health", holdings);
    const capped = health.findings.find((f) => /capped at 55/.test(f.message))!;
    expect(capped).toBeDefined();
    expect(capped.message).toMatch(/4\/7/);
  });

  it("does not cap when negative months are exactly half, which is not a majority", () => {
    const threeOfSix = [
      ...[1, 2, 3].flatMap((m) => [
        makeTxn(`2024-0${m}-01`, 6000, "salary"),
        makeTxn(`2024-0${m}-05`, -1200, "housing"),
      ]),
      ...[4, 5, 6].flatMap((m) => [
        makeTxn(`2024-0${m}-01`, 6000, "salary"),
        makeTxn(`2024-0${m}-05`, -6400, "housing"),
      ]),
    ];
    const health = moduleOf(threeOfSix, "health", holdings);
    expect(health.findings.some((f) => /most months were cash-flow negative/.test(f.message))).toBe(false);
  });
});

describe("regular spend in a recurring category is not an anomaly (D22)", () => {
  /**
   * The pooled-baseline false positive: groceries ~450/month dwarf dining ~100 and transport
   * ~60, and because no two grocery amounts are identical the identical-amount rule never saw
   * them, so every month of groceries was flagged.
   */
  const household = Array.from({ length: 6 }, (_, i) => i + 1).flatMap((m) => [
    makeTxn(`2024-0${m}-01`, 6000, "salary"),
    makeTxn(`2024-0${m}-03`, -1800, "housing", { description: `Rent ${m}` }),
    makeTxn(`2024-0${m}-08`, -(430 + (m - 1) * 7.35), "groceries", { description: `Groceries ${m}` }),
    makeTxn(`2024-0${m}-14`, -(88 + (m - 1) * 4.1), "dining", { description: `Dining ${m}` }),
    makeTxn(`2024-0${m}-20`, -(55 + (m - 1) * 2.2), "transport", { description: `Transit ${m}` }),
  ]);

  /**
   * The flagged transactions are identified by the descriptions in the module's evidence; a
   * finding's own message names the category, so matching descriptions against the message
   * would pass whatever the rule did.
   */
  const flagged = (txns: ReturnType<typeof makeTxn>[]): string[] =>
    moduleOf(txns, "anomaly").evidence.map((e) => e.label);

  it("flags no ordinary monthly grocery row", () => {
    expect(flagged(household)).toEqual([]);
    expect(findMetric([moduleOf(household, "anomaly")], "anomaly", "anomalies")).toBe(0);
  });

  it("still flags a genuine one-off inside that recurring category", () => {
    const withOneOff = [...household, makeTxn("2024-04-19", -2600, "groceries", { description: "Bulk pantry order" })];
    const labels = flagged(withOneOff);
    expect(labels.some((l) => /Bulk pantry order/.test(l))).toBe(true);
    expect(labels.filter((l) => /Groceries \d/.test(l))).toEqual([]);
  });

  it("does not treat a category present in only two months as a commitment", () => {
    // The guard against over-exclusion: if whole categories left the baseline rather than only
    // the candidate set, the baseline here would collapse and the 1,900 could stop being flagged.
    const shortCadence = [
      ...Array.from({ length: 6 }, (_, i) => i + 1).flatMap((m) => [
        makeTxn(`2024-0${m}-01`, 5200, "salary"),
        makeTxn(`2024-0${m}-04`, -1500, "housing", { description: `Rent ${m}` }),
        makeTxn(`2024-0${m}-09`, -(120 + (m - 1) * 4), "groceries", { description: `Shop ${m}` }),
        makeTxn(`2024-0${m}-17`, -(74 + (m - 1) * 2.5), "dining", { description: `Dinner ${m}` }),
      ]),
      makeTxn("2024-02-21", -1900, "travel", { description: "Flights" }),
      makeTxn("2024-05-23", -175, "travel", { description: "Rail pass" }),
    ];
    const labels = flagged(shortCadence);
    expect(labels.some((l) => /Flights/.test(l))).toBe(true);
    expect(labels.filter((l) => /Rail pass/.test(l))).toEqual([]);
  });

  it("keeps the median over the whole variable set, so the baseline is unchanged", () => {
    // Groceries stay in the distribution: the median of the 18 variable amounts is 98.25.
    expect(findMetric([moduleOf(household, "anomaly")], "anomaly", "medianOutflow")).toBeCloseTo(98.25, 6);
  });
});
