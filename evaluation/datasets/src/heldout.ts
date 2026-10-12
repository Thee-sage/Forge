import type { AmountFormat, AssetClassLabel, CellCase, ClassifyCase, DateFormat, Dataset, PipelineCase, ScenarioJson, TruthHolding, TruthTxn } from "../../types.js";
import { H, T, household, mk, monthly, truth } from "./builders.js";
import { DATASET_VERSION } from "../../version.js";
import { mulberry32 } from "../../stats.js";

/**
 * HELD-OUT split. Authored BEFORE any measurement and frozen by hash (MANIFEST.json).
 * It is for measurement only: no rule, threshold or parser may be tuned against a failure
 * seen here and then have this split reported as an independent result. If a held-out
 * failure motivates a fix, the report must say so (see ACCURACY_VALIDATION.md section 4).
 *
 * Contains: hand-written cases (different values and structure from dev) and a
 * seeded random batch whose only reference is the exact-arithmetic oracle.
 */
const c = mk("heldout");
const G = [27.4, 33.15, 29.9, 41.0, 36.25, 31.8, 38.6, 28.45, 34.7, 30.05, 39.1];
const lines = (vals: number[], prefix: string, day0 = 3) =>
  vals.map((v, i) => `2024-03-${String((i % 25) + day0).padStart(2, "0")} -${v.toFixed(2)} groceries ${prefix} ${i + 1}`);

const hand: PipelineCase[] = [
  // ---------------------------------------------------------------- cashflow
  c({
    id: "H-cf-001", family: "cashflow", tags: ["aggregation", "hand-calculated"],
    description: "Four months with a raise in March; worked by hand.",
    truth: truth(T(
      "2024-01-02 +3200 salary Salary", "2024-01-05 -1100 housing Rent", "2024-01-12 -275.40 groceries Food", "2024-01-20 -60 transport Fuel",
      "2024-02-02 +3200 salary Salary", "2024-02-05 -1100 housing Rent", "2024-02-12 -310.15 groceries Food", "2024-02-21 -45.50 dining Dinner",
      "2024-03-02 +3350 salary Salary", "2024-03-05 -1100 housing Rent", "2024-03-12 -298.90 groceries Food", "2024-03-25 -120 utilities Power",
      "2024-04-02 +3200 salary Salary", "2024-04-05 -1100 housing Rent", "2024-04-12 -305 groceries Food",
    )),
    hand: { "cashflow.inflow": 12950, "cashflow.outflow": 5814.95, "cashflow.net": 7135.05, "cashflow.savingsRate": 0.55096911197, "cashflow.avgMonthlyNet": 1783.7625, "cashflow.months": 4 },
    labels: { "insight:low-savings-driver": false, "finding:cashflow.negative-months": false },
  }),
  c({
    id: "H-cf-002", family: "cashflow", tags: ["debit-credit", "zero-outflow"],
    description: "Deposits only in Debit/Credit layout.",
    truth: truth(T("2024-02-10 +1500 salary Pay", "2024-03-10 +1500 salary Pay", "2024-03-18 +20.20 income Interest")),
    input: { amountFormat: "debitcredit" },
  }),
  c({
    id: "H-cf-003", family: "cashflow", tags: ["negative-net", "parentheses"],
    description: "Spending exceeds income in three of four months; accounting-style negatives.",
    truth: truth(T(
      "2024-05-01 +2400 salary Pay", "2024-05-09 -2900.50 housing Rent+bills",
      "2024-06-01 +2400 salary Pay", "2024-06-09 -2750 housing Rent+bills",
      "2024-07-01 +2400 salary Pay", "2024-07-09 -1500 housing Rent",
      "2024-08-01 +2400 salary Pay", "2024-08-09 -3100.25 housing Rent+repair",
    )),
    input: { amountFormat: "parens" },
    labels: { "insight:low-savings-driver": true, "finding:cashflow.negative-months": true, "insight:healthy-position": false },
  }),
  c({
    id: "H-cf-004", family: "cashflow", tags: ["zero-income", "abstention"],
    description: "One month of spending and no income.",
    truth: truth(T("2024-09-04 -75.20 groceries Food", "2024-09-11 -310 housing Rent share", "2024-09-30 -42.80 transport Taxi")),
    expect: { unavailable: ["cashflow.savingsRate", "health.score"] },
    labels: { "insight:low-savings-driver": false },
  }),
  c({
    id: "H-cf-005", family: "cashflow", tags: ["irregular-period"], ambiguous: true,
    note: "Same calendar-vs-active-month ambiguity as D-cf-008.",
    description: "Activity in Feb, May, Jun and Dec only.",
    truth: truth(T(
      "2024-02-14 +1800 salary Pay", "2024-02-20 -700 housing Rent",
      "2024-05-14 +1800 salary Pay", "2024-05-20 -720 housing Rent",
      "2024-06-14 +1800 salary Pay", "2024-06-20 -690 housing Rent",
      "2024-12-14 +1800 salary Pay", "2024-12-20 -1900 housing Rent",
    )),
  }),
  c({
    id: "H-cf-006", family: "cashflow", tags: ["calendar", "dmy"],
    description: "Year boundary written DD/MM/YYYY (days > 12 present).",
    truth: truth(T("2023-12-29 +900 salary Pay", "2024-01-01 -45.45 dining New year", "2024-01-31 -19.99 subscriptions Streaming")),
    input: { dateFormat: "dmy" },
  }),
  c({
    id: "H-cf-007", family: "cashflow", tags: ["float-accumulation"],
    description: "150 outflows of 0.07 and three inflows of 33.33.",
    truth: truth([
      ...T("2024-02-01 +33.33 income A", "2024-02-02 +33.33 income B", "2024-02-03 +33.33 income C"),
      ...Array.from({ length: 150 }, (_, i) => ({ date: `2024-02-${String((i % 27) + 1).padStart(2, "0")}`, amount: "-0.07", category: "misc", description: `Small ${i + 1}` })),
    ]),
    hand: { "cashflow.inflow": 99.99, "cashflow.outflow": 10.5, "cashflow.net": 89.49 },
  }),
  c({
    id: "H-cf-008", family: "cashflow", tags: ["category-normalisation"],
    description: "Mixed-case category cells.",
    truth: truth(T("2024-02-01 +2000 salary Pay", "2024-02-02 -80 transport A", "2024-02-03 -90 transport B", "2024-02-04 -100 transport C", "2024-02-05 -10 fees D")),
    input: { categoryText: ["SALARY", "Transport", "transport ", " TRANSPORT", "Fees"] },
  }),
  c({
    id: "H-cf-009", family: "cashflow", tags: ["refund"], ambiguous: true,
    note: "Refund as inflow (contract) vs reversal of spending (alternative).",
    description: "A partial refund.",
    truth: truth(T("2024-03-01 +2600 salary Pay", "2024-03-04 -420 shopping Jacket", "2024-03-15 +120 income Partial refund", "2024-03-20 -150 groceries Food")),
  }),
  c({
    id: "H-cf-010", family: "cashflow", tags: ["transfer"], ambiguous: true,
    note: "Transfer legs counted (contract) vs excluded (alternative).",
    description: "Moving money to savings and back.",
    truth: truth(T("2024-03-01 +2600 salary Pay", "2024-03-05 -800 transfer To savings", "2024-03-25 +300 transfer From savings", "2024-03-12 -640 housing Rent")),
  }),
  c({
    id: "H-cf-011", family: "cashflow", tags: ["thin-margin"],
    description: "Savings rate of 2%.",
    truth: truth(monthly("2024-04", 4, (ym) => [`${ym}-01 +2500 salary Pay`, `${ym}-05 -1500 housing Rent`, `${ym}-10 -950 groceries Living`])),
    labels: { "insight:low-savings-driver": true, "insight:healthy-position": false },
  }),
  c({
    id: "H-cf-012", family: "cashflow", tags: ["comfortable-margin"],
    description: "Savings rate of 22%.",
    truth: truth(monthly("2024-04", 4, (ym) => [`${ym}-01 +2500 salary Pay`, `${ym}-05 -1100 housing Rent`, `${ym}-10 -850 groceries Living`])),
    labels: { "insight:low-savings-driver": false },
  }),
  c({
    id: "H-cf-013", family: "cashflow", tags: ["currency-symbol"],
    description: "Dollar-prefixed amounts with thousands separators.",
    truth: truth(T("2024-04-05 +12500.25 salary Pay", "2024-04-09 -1700.35 housing Rent", "2024-05-05 +12500.25 salary Pay", "2024-05-11 -2088.88 dining Dinner")),
    input: { amountFormat: "symbol" },
  }),
  c({
    id: "H-cf-014", family: "cashflow", tags: ["large-values"],
    description: "Values near 5e8.",
    truth: truth(T("2024-06-03 +512345678.90 income Sale", "2024-06-04 -123456789.01 shopping Plant", "2024-06-05 -111111111.11 shopping Plant 2")),
    hand: { "cashflow.net": 277777778.78 },
  }),
  c({
    id: "H-cf-015", family: "cashflow", tags: ["negative-month"],
    description: "Six months with one negative month.",
    truth: truth(monthly("2024-01", 6, (ym, i) => [`${ym}-01 +4000 salary Pay`, `${ym}-06 -${i === 3 ? 4700 : 2400} housing Rent`, `${ym}-15 -300 groceries Food`])),
    labels: { "finding:cashflow.negative-months": true },
  }),

  // ---------------------------------------------------------------- trend
  c({
    id: "H-tr-001", family: "trend", tags: ["even-halves", "rise-and-fall"],
    description: "Eight months: transport rises 80 -> 200, dining falls 300 -> 150, groceries flat.",
    truth: truth(monthly("2024-01", 8, (ym, i) => [`${ym}-01 +5200 salary Pay`, `${ym}-03 -1400 housing Rent`, `${ym}-08 -450 groceries Food`, `${ym}-14 -${i < 4 ? 80 : 200} transport Transit`, `${ym}-18 -${i < 4 ? 300 : 150} dining Dining`])),
    labels: { "trend:transport": true, "trend:groceries": false, "insight:cashflow-decline-driver": false },
  }),
  c({
    id: "H-tr-002", family: "trend", tags: ["odd-halves"],
    description: "Three months: one earlier month vs two recent.",
    truth: truth([
      ...T("2024-01-01 +3000 salary Pay", "2024-02-01 +3000 salary Pay", "2024-03-01 +3000 salary Pay"),
      ...T("2024-01-09 -200 shopping Shop", "2024-02-09 -200 shopping Shop", "2024-03-09 -200 shopping Shop"),
      ...T("2024-01-15 -60 entertainment Fun", "2024-02-15 -160 entertainment Fun", "2024-03-15 -160 entertainment Fun"),
    ]),
    labels: { "trend:shopping": false, "trend:entertainment": true },
  }),
  c({
    id: "H-tr-003", family: "trend", tags: ["irregular-period"], ambiguous: true,
    note: "Active-month halves vs calendar halves (see D-tr-003).",
    description: "Active months Mar, Apr, Oct, Nov.",
    truth: truth(T(
      "2024-03-05 +2800 salary Pay", "2024-04-05 +2800 salary Pay", "2024-10-05 +2800 salary Pay", "2024-11-05 +2800 salary Pay",
      "2024-03-15 -70 dining Dining", "2024-04-15 -90 dining Dining", "2024-10-15 -240 dining Dining", "2024-11-15 -260 dining Dining",
    )),
  }),
  c({
    id: "H-tr-004", family: "trend", tags: ["decline", "spending-driven"],
    description: "Net falls by over half because shopping rises tenfold.",
    truth: truth(monthly("2024-01", 6, (ym, i) => [`${ym}-01 +4800 salary Pay`, `${ym}-03 -1300 housing Rent`, `${ym}-08 -350 groceries Food`, `${ym}-16 -${i < 3 ? 150 : 1750} shopping Retail`])),
    labels: { "insight:cashflow-decline-driver": true, "trend:shopping": true },
  }),
  c({
    id: "H-tr-005", family: "trend", tags: ["decline", "income-driven"],
    description: "Net falls because income drops by 60%; spending flat.",
    truth: truth(monthly("2024-01", 6, (ym, i) => [`${ym}-01 +${i < 3 ? 5000 : 2000} salary Pay`, `${ym}-03 -1300 housing Rent`, `${ym}-08 -350 groceries Food`, `${ym}-16 -150 shopping Retail`])),
    labels: { "insight:cashflow-decline-driver": true },
  }),
  c({
    id: "H-tr-006", family: "trend", tags: ["flat"],
    description: "Five identical months.",
    truth: truth(monthly("2024-02", 5, (ym) => [`${ym}-01 +3500 salary Pay`, `${ym}-04 -1200 housing Rent`, `${ym}-11 -330 groceries Food`])),
    labels: { "trend:groceries": false, "insight:cashflow-decline-driver": false },
  }),

  // ---------------------------------------------------------------- anomaly
  c({
    id: "H-an-001", family: "anomaly", tags: ["clear-outlier"],
    description: "Eleven ordinary charges and a 650 one-off.",
    truth: truth(T("2024-03-01 +3500 salary Pay", ...lines(G, "Shop"), "2024-03-29 -650 travel Train pass annual")),
    labels: { "anomaly:Train pass annual": true, "anomaly:Shop 4": false, "anomaly:Shop 9": false, "insight:anomaly-impact": true },
  }),
  c({
    id: "H-an-002", family: "anomaly", tags: ["tight-cluster"],
    description: "Nine near-identical charges.",
    truth: truth(T("2024-03-01 +3500 salary Pay", ...lines([22.5, 23.1, 21.9, 22.8, 23.4, 22.2, 21.7, 23.0, 22.6], "Lunch"))),
    labels: { "anomaly:Lunch 2": false, "anomaly:Lunch 3": false, "anomaly:Lunch 9": false, "insight:anomaly-impact": false },
  }),
  c({
    id: "H-an-003", family: "anomaly", tags: ["recurring"],
    description: "A 15.99 subscription six times plus varied small spend.",
    truth: truth(monthly("2024-01", 6, (ym, i) => [`${ym}-01 +2500 salary Pay`, `${ym}-05 -15.99 subscriptions Stream ${ym}`, `${ym}-17 -${(31 + i * 4.3).toFixed(2)} dining Meal ${i + 1}`])),
    labels: { "anomaly:Stream 2024-02": false, "anomaly:Stream 2024-05": false, "insight:anomaly-impact": false },
  }),
  c({
    id: "H-an-004", family: "anomaly", tags: ["short-history", "abstention"],
    description: "Three outflows only.",
    truth: truth(T("2024-03-01 +3500 salary Pay", "2024-03-02 -12 dining Tea", "2024-03-03 -14 dining Tea 2", "2024-03-04 -700 shopping Gadget")),
    labels: { "anomaly:Gadget": false, "insight:anomaly-impact": false },
  }),
  c({
    id: "H-an-005", family: "anomaly", tags: ["zero-variance"],
    description: "Six identical 12.00 outflows.",
    truth: truth(T("2024-03-01 +3500 salary Pay", ...Array.from({ length: 6 }, (_, i) => `2024-03-${String(i + 2).padStart(2, "0")} -12.00 subscriptions Sub ${i + 1}`))),
    labels: { "anomaly:Sub 1": false, "anomaly:Sub 6": false, "insight:anomaly-impact": false },
  }),
  c({
    id: "H-an-006", family: "anomaly", tags: ["near-duplicate", "zero-mad"], ambiguous: true,
    note: "MAD = 0 makes the documented numeric rule undefined; the label (25.40 is 1.6% above the cluster, not an outlier) is unambiguous.",
    description: "Variable spend 25.00, 25.00, 25.40 and a 60.00 bill three times.",
    truth: truth(T("2024-03-01 +3500 salary Pay", "2024-03-02 -25.00 dining Snack A", "2024-03-03 -25.00 dining Snack B", "2024-03-04 -25.40 dining Snack C", "2024-03-05 -60.00 utilities Bill 1", "2024-04-05 -60.00 utilities Bill 2", "2024-05-05 -60.00 utilities Bill 3")),
    labels: { "anomaly:Snack C": false, "anomaly:Snack A": false, "insight:anomaly-impact": false },
  }),
  c({
    id: "H-an-007", family: "anomaly", tags: ["largest-is-recurring"],
    description: "Largest outflow is a recurring 1800 rent; the only outlier is a 350 vet bill (3.6% of spending).",
    truth: truth(T(
      "2024-03-01 +9000 salary Pay", "2024-03-02 -1800 housing Rent 1", "2024-04-02 -1800 housing Rent 2", "2024-05-02 -1800 housing Rent 3", "2024-06-02 -1800 housing Rent 4", "2024-07-02 -1800 housing Rent 5",
      ...lines(G.slice(0, 9), "Shop"), "2024-03-30 -350 health Vet",
    )),
    labels: { "anomaly:Vet": true, "insight:anomaly-impact": false },
  }),
  c({
    id: "H-an-008", family: "anomaly", tags: ["two-outliers"],
    description: "Two one-offs (500 and 2200) among ordinary spend.",
    truth: truth(T("2024-03-01 +7000 salary Pay", ...lines(G, "Shop"), "2024-03-27 -500 shopping Bike", "2024-03-28 -2200 travel Holiday")),
    labels: { "anomaly:Bike": true, "anomaly:Holiday": true, "anomaly:Shop 3": false, "insight:anomaly-impact": true },
  }),
  c({
    id: "H-an-009", family: "anomaly", tags: ["low-side"],
    description: "A 1.20 charge among ~33 charges.",
    truth: truth(T("2024-03-01 +3500 salary Pay", ...lines(G.slice(0, 9), "Shop"), "2024-03-29 -1.20 misc Sample")),
    labels: { "anomaly:Sample": false, "insight:anomaly-impact": false },
  }),
  c({
    id: "H-an-010", family: "anomaly", tags: ["multi-category", "pooled-baseline", "recurring-drift"],
    note: "Rubric 1.1.0: groceries are present in all seven months with no two amounts alike and are ordinary for that category, so they are FALSE despite being 4.35x the pooled median of 116.20 (ungraded under rubric 1.0.0). Dining at 0.89x is FALSE under either rubric version.",
    description: "Seven months of a household whose groceries (~530) dwarf its dining (~115) and transport (~74). Every grocery month is ordinary for this household.",
    truth: truth(monthly("2024-01", 7, (ym, i) => [
      `${ym}-01 +5800 salary Pay`, `${ym}-04 -1650 housing Rent ${ym}`,
      `${ym}-09 -${(505 + i * 8.2).toFixed(2)} groceries Market ${i + 1}`,
      `${ym}-16 -${(103 + i * 4.4).toFixed(2)} dining Bistro ${i + 1}`,
      `${ym}-23 -${(66 + i * 2.6).toFixed(2)} transport Bus ${i + 1}`,
    ])),
    labels: { "anomaly:Market 2": false, "anomaly:Market 6": false, "anomaly:Bistro 3": false },
  }),
  c({
    id: "H-an-011", family: "anomaly", tags: ["multi-category", "one-off-inside-recurring"],
    note: "Rubric 1.1.0: the 3,100 order is 24.4x the pooled median of 127 and far outside what is ordinary for its own category, so TRUE. The ~480 monthly rows are regular spend, so FALSE (3.7x, ungraded under rubric 1.0.0). anomaly-impact left ungraded at 16.6% of outflow.",
    description: "Groceries recur monthly at ~490 and one month carries a 3,100 order.",
    truth: truth([
      ...monthly("2024-02", 6, (ym, i) => [
        `${ym}-02 +7200 salary Pay`, `${ym}-05 -1900 housing Rent ${ym}`,
        `${ym}-11 -${(470 + i * 9.3).toFixed(2)} groceries Food shop ${i + 1}`,
        `${ym}-18 -${(112 + i * 5).toFixed(2)} dining Lunch ${i + 1}`,
        `${ym}-25 -${(70 + i * 3).toFixed(2)} transport Fare ${i + 1}`,
      ]),
      ...T("2024-04-24 -3100 groceries Annual bulk order"),
    ]),
    labels: { "anomaly:Annual bulk order": true, "anomaly:Food shop 3": false, "anomaly:Food shop 6": false },
  }),
  c({
    id: "H-an-012", family: "anomaly", tags: ["multi-category", "short-cadence", "over-exclusion-guard"],
    note: "The held-out twin of D-an-013. Travel occurs in two of six months, so it is not a recurring commitment: Flight to Lisbon is 14.9x the pooled median of 137.50 (TRUE) and Rail pass is 1.38x (FALSE).",
    description: "Travel appears in only two of six months; groceries and dining recur in all six.",
    truth: truth([
      ...monthly("2024-01", 6, (ym, i) => [
        `${ym}-01 +4800 salary Pay`, `${ym}-03 -1350 housing Rent ${ym}`,
        `${ym}-10 -${(135 + i * 5).toFixed(2)} groceries Corner shop ${i + 1}`,
        `${ym}-19 -${(80 + i * 3).toFixed(2)} dining Takeaway ${i + 1}`,
      ]),
      ...T("2024-03-22 -2050 travel Flight to Lisbon", "2024-06-18 -190 travel Rail pass"),
    ]),
    labels: { "anomaly:Flight to Lisbon": true, "anomaly:Rail pass": false, "anomaly:Corner shop 2": false },
  }),

  // ----------------------------------------------- realistic statement shapes (held-out)
  // Structurally analogous to D-rl-001..003 with different merchants, values and variants, so
  // they measure whether anything learned from the dev twins generalises. Authored before any
  // of them had been run.
  c({
    id: "H-rl-001", family: "realworld", tags: ["merchant-churn", "inferred-category"],
    note: "No category column; categories must be inferred from real-looking bank strings. Different merchants and abbreviation styles from D-rl-001.",
    description: "Four months of one current account with no category column and bank-style merchant strings.",
    input: { omitCategory: true },
    truth: truth(T(
      "2024-02-01 +2750 salary NORTHWIND SALARY FEB",
      "2024-02-03 -865 housing MONTHLY RENT 12A",
      "2024-02-07 -74.20 groceries ALDI STORES 1102",
      "2024-02-13 -9.99 subscriptions SPOTIFY P1BC4D",
      "2024-02-20 -36.80 transport RAIL TICKET MACHINE",
      "2024-03-01 +2750 salary NORTHWIND SALARY MAR",
      "2024-03-03 -865 housing MONTHLY RENT 12A",
      "2024-03-08 -81.45 groceries ALDI SUPERMARKET 889",
      "2024-03-16 -22.40 dining COSTA COFFEE 221",
      "2024-03-24 -48.50 transport BP SERVICE STN 4471",
      "2024-04-01 +2750 salary NORTHWIND SALARY APR",
      "2024-04-03 -865 housing MONTHLY RENT 12A",
      "2024-04-10 -69.95 groceries LIDL GB 0774",
      "2024-04-18 -27.50 shopping ARGOS RETAIL 3310",
      "2024-05-01 +2750 salary NORTHWIND SALARY MAY",
      "2024-05-03 -865 housing MONTHLY RENT 12A",
    )),
  }),
  c({
    id: "H-rl-002", family: "realworld", tags: ["multiple-accounts", "own-transfer"], ambiguous: true,
    note: "Held-out twin of D-rl-002: two accounts and a monthly own-account transfer pair, scored against the contract reading (§6.4).",
    description: "A current account and an instant-access saver over four months, with monthly transfers between them.",
    truth: truth(T(
      "2024-03-01 +3650 salary Salary",
      "2024-03-04 -1095 housing Rent",
      "2024-03-06 -450 transfer Standing order to saver",
      "2024-03-06 +450 transfer Standing order from current",
      "2024-03-15 -276.55 groceries Supermarket",
      "2024-04-01 +3650 salary Salary",
      "2024-04-04 -1095 housing Rent",
      "2024-04-06 -450 transfer Standing order to saver",
      "2024-04-06 +450 transfer Standing order from current",
      "2024-04-15 -289.90 groceries Supermarket",
      "2024-05-01 +3650 salary Salary",
      "2024-05-04 -1095 housing Rent",
      "2024-05-06 -450 transfer Standing order to saver",
      "2024-05-06 +450 transfer Standing order from current",
      "2024-05-15 -301.20 groceries Supermarket",
      "2024-06-01 +3650 salary Salary",
      "2024-06-04 -1095 housing Rent",
      "2024-06-06 -450 transfer Standing order to saver",
      "2024-06-06 +450 transfer Standing order from current",
      "2024-06-15 -294.75 groceries Supermarket",
    )),
  }),
  c({
    id: "H-rl-003", family: "realworld", tags: ["partial-months", "instalments", "refund"], ambiguous: true,
    note: "Held-out twin of D-rl-003: a statement starting on the 23rd and ending on the 6th, an instalment plan and a partial refund.",
    description: "Statement running 23 Feb to 6 Jun: partial first and last months, an instalment plan, and a partial refund.",
    truth: truth(T(
      "2024-02-23 +1900 salary Salary part month",
      "2024-02-27 -186.40 groceries Grocery run",
      "2024-03-01 -232 shopping Mattress instalment 1 of 3",
      "2024-03-05 +5100 salary Salary",
      "2024-03-09 -1320 housing Rent",
      "2024-03-17 -264.85 groceries Grocery run",
      "2024-04-01 -232 shopping Mattress instalment 2 of 3",
      "2024-04-05 +5100 salary Salary",
      "2024-04-09 -1320 housing Rent",
      "2024-04-16 -279.30 groceries Grocery run",
      "2024-04-27 -615 shopping Winter clothing",
      "2024-05-01 -232 shopping Mattress instalment 3 of 3",
      "2024-05-05 +5100 salary Salary",
      "2024-05-09 -1320 housing Rent",
      "2024-05-19 -288.15 groceries Grocery run",
      "2024-06-03 +1700 salary Salary part month",
      "2024-06-06 +240 income Refund for returned clothing",
    )),
  }),

  // ---------------------------------------------------------------- portfolio
  c({
    id: "H-pf-001", family: "portfolio", tags: ["equal-weights", "hand-calculated"],
    description: "Five equal positions: HHI = 0.2, effective positions = 5.",
    truth: truth([], H("A 8000 equity", "B 8000 equity", "C 8000 equity", "D 8000 equity", "E 8000 equity")),
    hand: { "concentration.hhi": 0.2, "concentration.effectivePositions": 5, "concentration.topWeight": 0.2, "concentration.top3Weight": 0.6, "concentration.positions": 5, "allocation.portfolioValue": 40000 },
    labels: { "insight:portfolio-concentration": false },
  }),
  c({
    id: "H-pf-002", family: "portfolio", tags: ["single-position", "all-cash"],
    description: "A single cash holding.",
    truth: truth([], H("SAV 4321.09 cash")),
    labels: { "insight:portfolio-concentration": false },
  }),
  c({
    id: "H-pf-003", family: "portfolio", tags: ["cash-heavy"],
    description: "55% cash plus ten equal equities.",
    truth: truth([], H("CASH 55000 cash", ...Array.from({ length: 10 }, (_, i) => `Q${i + 1} 4500 equity`))),
    labels: { "insight:portfolio-concentration": false },
  }),
  c({
    id: "H-pf-004", family: "portfolio", tags: ["dominant-position"],
    description: "Top holding is 55% of investments (HHI 0.37).",
    truth: truth([], H("TOP 55000 equity", "R1 15000 equity", "R2 15000 fixed_income", "R3 15000 real_estate")),
    labels: { "insight:portfolio-concentration": true },
  }),
  c({
    id: "H-pf-005", family: "portfolio", tags: ["no-holdings", "abstention"],
    description: "Transactions only.",
    truth: truth(T("2024-03-01 +2000 salary Pay", "2024-03-05 -600 housing Rent")),
    expect: { unavailable: ["concentration.hhi", "allocation.cashWeight"] },
  }),
  c({
    id: "H-pf-006", family: "portfolio", tags: ["class-text"],
    description: "Free-text classes: Equities, Corporate Bonds, Savings, Commodities.",
    truth: truth([], H("W 30000 equity", "X 25000 fixed_income", "Y 15000 cash", "Z 10000 commodity")),
    input: { holdingClassText: ["Equities", "Corporate Bonds", "Savings", "Commodities"] },
  }),
  c({
    id: "H-pf-007", family: "portfolio", tags: ["duplicate-symbol"], ambiguous: true,
    note: "Same ticker in two accounts (see D-pf-008).",
    description: "NVDA appears in two rows.",
    truth: truth([], H("NVDA 20000 equity", "NVDA 22000 equity", "TLT 18000 fixed_income")),
  }),
  c({
    id: "H-pf-008", family: "portfolio", tags: ["cash-top-position"],
    description: "Cash is the largest row (45%); investments split 60/40.",
    truth: truth(T("2024-03-01 +2000 salary Pay", "2024-03-05 -600 housing Rent"), H("CASH 450 cash", "AAA 330 equity", "BBB 220 equity")),
    labels: { "insight:portfolio-concentration": true },
  }),
  c({
    id: "H-pf-009", family: "portfolio", tags: ["class-text", "wrapper"],
    description: "Wrappers: a short-term treasury fund, a real-estate fund, a crypto ETF and an index ETF.",
    truth: truth([], H("F1 20000 fixed_income", "F2 20000 real_estate", "F3 20000 crypto", "F4 20000 equity")),
    input: { holdingClassText: ["Short-term Bond Fund", "Real Estate Fund", "Crypto ETF", "Index ETF"] },
  }),
  c({
    id: "H-pf-010", family: "portfolio", tags: ["many-positions"],
    description: "Thirty positions with graded sizes.",
    truth: truth([], H(...Array.from({ length: 30 }, (_, i) => `N${i + 1} ${500 + i * 211} ${(["equity", "fixed_income", "cash", "commodity", "alternative", "equity"] as const)[i % 6]}`))),
  }),

  // ---------------------------------------------------------------- health
  c({
    id: "H-hl-001", family: "health", tags: ["runway", "short"],
    description: "Cash covers half a month: runway 0.5 (cap 55 applies if score > 55).",
    truth: truth(monthly("2024-01", 4, (ym) => [`${ym}-01 +5000 salary Pay`, `${ym}-05 -1600 housing Rent`, `${ym}-12 -400 groceries Food`]), H("CASH 1000 cash", "E1 25000 equity", "E2 25000 equity", "B1 25000 fixed_income")),
    labels: { "insight:thin-liquidity": true },
  }),
  c({
    id: "H-hl-002", family: "health", tags: ["runway", "long"],
    description: "Cash covers 12 months.",
    truth: truth(monthly("2024-01", 4, (ym) => [`${ym}-01 +5000 salary Pay`, `${ym}-05 -1600 housing Rent`, `${ym}-12 -400 groceries Food`]), H("CASH 24000 cash", "E1 25000 equity", "B1 25000 fixed_income")),
    labels: { "insight:thin-liquidity": false },
  }),
  c({
    id: "H-hl-003", family: "health", tags: ["cap", "net-negative"],
    description: "Spending exceeds income with high liquidity: cap 45.",
    truth: truth(monthly("2024-01", 5, (ym) => [`${ym}-01 +3500 salary Pay`, `${ym}-05 -3900 housing Rent`]), H("CASH 90000 cash", "E1 40000 equity", "E2 40000 equity", "B1 40000 fixed_income")),
  }),
  c({
    id: "H-hl-004", family: "health", tags: ["cap", "majority-negative"],
    note: "7 months, 4 negative (57%): a strict majority, so the documented rule caps at 55. Interpretation-dependent under dataset 1.0.0 while the code capped only below 34% non-negative; settled by D21 in favour of the documented rule. The expected value has not changed. See D-hl-004.",
    description: "Seven months, four negative.",
    truth: truth(T(
      "2024-01-01 +4000 salary Pay", "2024-01-05 -1000 housing Rent",
      "2024-02-01 +4000 salary Pay", "2024-02-05 -1000 housing Rent",
      "2024-03-01 +4000 salary Pay", "2024-03-05 -1000 housing Rent",
      "2024-04-01 +1000 salary Pay", "2024-04-05 -1900 housing Rent",
      "2024-05-01 +1000 salary Pay", "2024-05-05 -1900 housing Rent",
      "2024-06-01 +1000 salary Pay", "2024-06-05 -1900 housing Rent",
      "2024-07-01 +1000 salary Pay", "2024-07-05 -1900 housing Rent",
    ), H("CASH 40000 cash", "F1 40000 equity", "F2 40000 equity", "B1 40000 fixed_income")),
  }),
  c({
    id: "H-hl-005", family: "health", tags: ["strong"],
    description: "Eight months, ~45% savings, no negative month, ample cash.",
    truth: truth(monthly("2024-01", 8, (ym) => [`${ym}-01 +7000 salary Pay`, `${ym}-05 -2300 housing Rent`, `${ym}-12 -800 groceries Food`, `${ym}-20 -500 utilities Bills`]), H("CASH 36000 cash", "E1 25000 equity", "E2 25000 equity", "B1 25000 fixed_income", "R1 20000 real_estate")),
    labels: { "insight:healthy-position": true, "insight:low-savings-driver": false, "insight:thin-liquidity": false },
  }),
  c({
    id: "H-hl-006", family: "health", tags: ["insufficient-history", "abstention"],
    description: "Two excellent months only.",
    truth: truth(monthly("2024-01", 2, (ym) => [`${ym}-01 +6000 salary Pay`, `${ym}-05 -1500 housing Rent`])),
    labels: { "insight:healthy-position": false },
  }),
  c({
    id: "H-hl-007", family: "health", tags: ["holdings-only", "abstention"],
    description: "Holdings with no transactions.",
    truth: truth([], H("CASH 500 cash", "E1 9500 equity")),
    expect: { unavailable: ["health.score", "health.runwayMonths"] },
  }),
  c({
    id: "H-hl-008", family: "health", tags: ["runway", "boundary"],
    description: "Cash is 99% of one month's spending: runway 0.99.",
    truth: truth(monthly("2024-01", 3, (ym) => [`${ym}-01 +4000 salary Pay`, `${ym}-05 -2000 housing Rent`]), H("CASH 1980 cash", "E1 40000 equity", "B1 20000 fixed_income")),
    labels: { "insight:thin-liquidity": true },
  }),

  // ---------------------------------------------------------------- scenarios
  ...(() => {
    const h = household("b");
    const mkS = (id: string, description: string, scenarios: ScenarioJson[], extra: Partial<PipelineCase> = {}): PipelineCase =>
      c({ id, family: "scenario", tags: ["scenario"], description, truth: truth(h.txns, h.holdings), scenarios, ...extra });
    return [
      mkS("H-sc-001", "Income +15%.", [{ incomePct: "0.15" }]),
      mkS("H-sc-002", "Expenses -10% (savings).", [{ expensePct: "-0.1" }]),
      mkS("H-sc-003", "Income -30% and expenses +20%.", [{ incomePct: "-0.3", expensePct: "0.2" }]),
      mkS("H-sc-004", "Recurring 450/month.", [{ recurringExpense: { amount: "450", category: "car" } }]),
      mkS("H-sc-005", "One-off 12000.", [{ oneOffExpense: { amount: "12000", category: "repairs" } }]),
      mkS("H-sc-006", "Empty scenario equals baseline.", [{}]),
      mkS("H-sc-007", "Income -100%.", [{ incomePct: "-1" }]),
      mkS("H-sc-008", "Two scenarios in sequence on the same model.", [{ expensePct: "0.25" }, { recurringExpense: { amount: "99.99", category: "misc" }, oneOffExpense: { amount: "750.50", category: "misc" } }]),
    ];
  })(),
  c({
    id: "H-sc-009", family: "scenario", tags: ["scenario", "missing-baseline"],
    description: "No baseline spending (no runway); the scenario adds a recurring expense.",
    truth: truth(monthly("2024-03", 3, (ym) => [`${ym}-01 +2000 salary Pay`]), H("CASH 9000 cash", "E 1000 equity")),
    scenarios: [{ recurringExpense: { amount: "500", category: "rent" } }],
  }),
  c({
    id: "H-sc-010", family: "safety", tags: ["scenario", "invalid-input"],
    description: "Invalid scenario inputs must be rejected.",
    truth: truth(T("2024-03-01 +2000 salary Pay", "2024-03-05 -600 housing Rent")),
    scenarios: [{ incomePct: "-3" }, { expensePct: "-1.01" }, { recurringExpense: { amount: "-100", category: "x" } }, { oneOffExpense: { amount: "Infinity", category: "x" } }],
    expect: { metrics: false, scenarioMustReject: true },
  }),

  // ---------------------------------------------------------------- safety
  c({
    id: "H-sf-001", family: "safety", tags: ["currency"],
    description: "EUR and GBP rows in one file.",
    truth: truth(T("2024-03-01 +100 salary A", "2024-03-02 -20 groceries B", "2024-03-03 -5 dining C")),
    input: { currencyColumn: ["EUR", "GBP", "EUR"] }, expect: { metrics: false, error: "CurrencyMismatchError" },
  }),
  c({
    id: "H-sf-002", family: "safety", tags: ["currency", "symbols"],
    description: "Pound and dollar symbols mixed across amount cells.",
    truth: truth(T("2024-03-01 +100 salary A", "2024-03-02 -20 groceries B")),
    input: { rawTransactionsCsv: "Date,Description,Amount,Category\n2024-03-01,A,£100.00,salary\n2024-03-02,B,-$20.00,groceries\n" },
    expect: { metrics: false, abstain: { error: "CurrencyMismatchError", warning: "currenc" } },
  }),
  c({
    id: "H-sf-003", family: "safety", tags: ["skipped-rows"],
    description: "Blank amount, blank date and a text date.",
    truth: truth(T("2024-03-01 +100 salary Good")),
    input: { rawTransactionsCsv: "Date,Description,Amount,Category\n2024-03-01,Good,100.00,salary\n2024-03-02,Blank amount,,misc\n,Blank date,-4.00,misc\nnot-a-date,Text date,-6.00,misc\n" },
    expect: { skipped: [{ table: "transactions", row: 1, reason: "amount" }, { table: "transactions", row: 2, reason: "date" }, { table: "transactions", row: 3, reason: "date" }] },
  }),
  c({
    id: "H-sf-004", family: "safety", tags: ["skipped-rows", "calendar"],
    description: "31 April and a 00 month are impossible dates.",
    truth: truth(T("2024-03-01 +100 salary Good")),
    input: { rawTransactionsCsv: "Date,Description,Amount,Category\n2024-03-01,Good,100.00,salary\n31/04/2024,Impossible,-5.00,misc\n2024-00-05,Zero month,-6.00,misc\n" },
    expect: { skipped: [{ table: "transactions", row: 1, reason: "date" }, { table: "transactions", row: 2, reason: "date" }] },
  }),
  c({
    id: "H-sf-005", family: "safety", tags: ["skipped-rows", "non-finite"],
    description: "Overflowing exponent, negative infinity and a double-dot amount.",
    truth: truth(T("2024-03-01 +100 salary Good")),
    input: { rawTransactionsCsv: "Date,Description,Amount,Category\n2024-03-01,Good,100.00,salary\n2024-03-02,Overflow,1e400,misc\n2024-03-03,NegInf,-Infinity,misc\n2024-03-04,Dots,12.50.00,misc\n" },
    expect: { skipped: [{ table: "transactions", row: 1, reason: "amount" }, { table: "transactions", row: 2, reason: "amount" }, { table: "transactions", row: 3, reason: "amount" }] },
  }),
  c({
    id: "H-sf-006", family: "safety", tags: ["skipped-rows", "holdings"],
    description: "Holding with unparseable value and no quantity/price; holding with negative price.",
    truth: truth([], H("OK 700 equity")),
    input: { rawHoldingsCsv: "Symbol,Name,Asset Class,Quantity,Price,Value\nOK,OK,equity,1,700,700\nBAD,BAD,equity,,,abc\nSHORT,SHORT,equity,5,-10,\n" },
    expect: { skipped: [{ table: "holdings", row: 1, reason: "non-positive|missing" }, { table: "holdings", row: 2, reason: "negative|non-positive" }] },
  }),
  c({
    id: "H-sf-007", family: "safety", tags: ["contradictory", "debit-credit"],
    description: "Second row has both debit and credit populated.",
    truth: truth([]),
    input: { rawTransactionsCsv: "Date,Description,Debit,Credit,Category\n2024-03-05,Fine,10.00,,misc\n2024-03-06,Both,75.00,75.00,misc\n" },
    expect: { metrics: false, abstain: { row: { table: "transactions", index: 1 }, warning: "debit|credit" } },
  }),
  c({
    id: "H-sf-008", family: "safety", tags: ["currency", "unrecognised"],
    description: "Currency cell reads 'Pesos'.",
    truth: truth([]),
    input: { rawTransactionsCsv: "Date,Description,Amount,Category,Currency\n2024-03-05,Row,-100.00,misc,Pesos\n2024-03-06,Row2,-10.00,misc,USD\n" },
    expect: { metrics: false, abstain: { error: "CurrencyMismatchError", row: { table: "transactions", index: 0 }, warning: "currenc" } },
  }),
  c({
    id: "H-sf-009", family: "safety", tags: ["contradictory", "holdings"],
    description: "Quantity 4 x price 250 = 1000, value cell says 3000.",
    truth: truth([], H("Y 3000 equity")),
    input: { rawHoldingsCsv: "Symbol,Name,Asset Class,Quantity,Price,Value\nY,Y,equity,4,250,3000\n" },
    expect: { metrics: false, warnings: ["value|quantity|price|inconsisten|contradict"] },
  }),
  c({
    id: "H-sf-010", family: "safety", tags: ["duplicates"],
    declaredUnsupported: "Duplicate-transaction detection is a documented limitation. Reported, never scored.",
    description: "Three identical rows.",
    truth: truth(T("2024-03-05 -9.99 subscriptions Dup")),
    input: { rawTransactionsCsv: "Date,Description,Amount,Category\n2024-03-05,Dup,-9.99,subscriptions\n2024-03-05,Dup,-9.99,subscriptions\n2024-03-05,Dup,-9.99,subscriptions\n" },
    expect: { metrics: false, warnings: ["duplicate"] },
  }),
  c({
    id: "H-sf-011", family: "safety", tags: ["ingestion"],
    description: "Header-only holdings-shaped file.",
    truth: truth([]),
    input: { rawTransactionsCsv: "Symbol,Quantity,Price\n" }, expect: { metrics: false, error: "IngestionError" },
  }),
  c({
    id: "H-sf-012", family: "safety", tags: ["ingestion"],
    description: "Unsupported .json extension.",
    truth: truth([]),
    input: { rawTransactionsCsv: "{}", transactionsFileName: "export.json" }, expect: { metrics: false, error: "IngestionError" },
  }),
  c({
    id: "H-sf-013", family: "safety", tags: ["ingestion"],
    description: "File does not exist.",
    truth: truth([]),
    input: { transactionsFileName: "__missing__.csv" }, expect: { metrics: false, error: "IngestionError" },
  }),
  c({
    id: "H-sf-014", family: "safety", tags: ["single-transaction", "abstention"],
    description: "A lone outflow.",
    truth: truth(T("2024-03-05 -49.99 shopping Lone")),
    expect: { unavailable: ["trend.categoriesChanged", "anomaly.medianOutflow", "concentration.hhi", "cashflow.savingsRate", "health.score"] },
    labels: { "insight:healthy-position": false, "insight:low-savings-driver": false },
  }),
  c({
    id: "H-sf-015", family: "safety", tags: ["currency", "holdings"],
    description: "GBP transactions with USD holdings (symbol amount in transactions, USD column in holdings).",
    truth: truth(T("2024-03-01 +100 salary A", "2024-03-02 -20 groceries B"), H("X 1000 equity"), "GBP"),
    input: { currencyColumn: ["GBP", "GBP"], rawHoldingsCsv: "Symbol,Name,Asset Class,Quantity,Price,Value,Currency\nX,X,equity,1,1000,1000,USD\n" },
    expect: { metrics: false, error: "CurrencyMismatchError" },
  }),
];

// ------------------------------------------------------------------ seeded random batch
// The only reference for these cases is the exact-arithmetic oracle. No labels.
function randomCases(count: number, seed: number): PipelineCase[] {
  const rand = mulberry32(seed);
  const int = (lo: number, hi: number): number => lo + Math.floor(rand() * (hi - lo + 1));
  const pick = <X,>(xs: readonly X[]): X => xs[int(0, xs.length - 1)]!;
  const cents = (lo: number, hi: number): string => {
    const c0 = int(lo * 100, hi * 100);
    return `${Math.floor(c0 / 100)}.${String(c0 % 100).padStart(2, "0")}`;
  };
  const cats = ["groceries", "housing", "dining", "transport", "utilities", "health", "travel", "shopping", "subscriptions", "entertainment"] as const;
  const classes: AssetClassLabel[] = ["equity", "fixed_income", "cash", "real_estate", "commodity", "crypto", "alternative"];
  const amountFormats: AmountFormat[] = ["signed", "parens", "symbol", "debitcredit"];
  const dateFormats: DateFormat[] = ["iso", "iso", "dmy", "long"];
  const out: PipelineCase[] = [];

  for (let k = 0; k < count; k++) {
    const nMonths = int(1, 9);
    const startMonth = int(0, 11);
    const noIncome = rand() < 0.1;
    const txns: TruthTxn[] = [];
    for (let m = 0; m < nMonths; m++) {
      const idx = startMonth + m;
      const ym = `${2023 + Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;
      if (!noIncome && rand() < 0.95) txns.push({ date: `${ym}-${String(int(1, 28)).padStart(2, "0")}`, amount: cents(1500, 9000), category: "salary", description: `Pay ${ym}` });
      if (rand() < 0.15) txns.push({ date: `${ym}-${String(int(1, 28)).padStart(2, "0")}`, amount: cents(20, 400), category: "income", description: `Extra ${ym}` });
      const spend = int(1, 6);
      for (let s = 0; s < spend; s++) {
        txns.push({ date: `${ym}-${String(int(1, 28)).padStart(2, "0")}`, amount: `-${cents(3, 2500)}`, category: pick(cats), description: `Item ${k}-${m}-${s}` });
      }
    }
    const nHold = rand() < 0.3 ? 0 : int(1, 12);
    const holdings: TruthHolding[] = Array.from({ length: nHold }, (_, i) => ({ symbol: `S${k}_${i}`, value: cents(50, 90000), assetClass: pick(classes) }));
    const scenarios: ScenarioJson[] = [];
    const nScen = rand() < 0.5 ? int(1, 2) : 0;
    for (let s = 0; s < nScen; s++) {
      const spec: ScenarioJson = {};
      if (rand() < 0.5) spec.incomePct = pick(["-0.5", "-0.2", "-0.05", "0.1", "0.25", "-1"]);
      if (rand() < 0.5) spec.expensePct = pick(["-0.3", "-0.1", "0.07", "0.2", "0.5"]);
      if (rand() < 0.3) spec.recurringExpense = { amount: cents(20, 600), category: "extra" };
      if (rand() < 0.3) spec.oneOffExpense = { amount: cents(100, 9000), category: "extra" };
      scenarios.push(spec);
    }
    out.push(c({
      id: `H-rnd-${String(k + 1).padStart(3, "0")}`, family: "random", tags: ["random", `seed-${seed}`],
      description: `Random ledger: ${nMonths} month(s), ${txns.length} rows, ${nHold} holding(s), ${scenarios.length} scenario(s)${noIncome ? ", no income" : ""}.`,
      truth: truth(txns, holdings),
      input: { amountFormat: pick(amountFormats), dateFormat: pick(dateFormats) },
      scenarios,
    }));
  }
  return out;
}

const cells: CellCase[] = [
  { id: "H-cell-a01", split: "heldout", family: "cell", kind: "amount", raw: "250.00", expected: "250.00" },
  { id: "H-cell-a02", split: "heldout", family: "cell", kind: "amount", raw: "-0.01", expected: "-0.01" },
  { id: "H-cell-a03", split: "heldout", family: "cell", kind: "amount", raw: "(0.99)", expected: "-0.99" },
  { id: "H-cell-a04", split: "heldout", family: "cell", kind: "amount", raw: "£1,200.50", expected: "1200.50" },
  { id: "H-cell-a05", split: "heldout", family: "cell", kind: "amount", raw: "-€2,000", expected: "-2000" },
  { id: "H-cell-a06", split: "heldout", family: "cell", kind: "amount", raw: "INR 1,00,000.50", expected: "100000.50" },
  { id: "H-cell-a07", split: "heldout", family: "cell", kind: "amount", raw: "2.5E2", expected: "250" },
  { id: "H-cell-a08", split: "heldout", family: "cell", kind: "amount", raw: "1,234.567", expected: "1234.567" },
  { id: "H-cell-a09", split: "heldout", family: "cell", kind: "amount", raw: "12.50.00", expected: null },
  { id: "H-cell-a10", split: "heldout", family: "cell", kind: "amount", raw: "--5", expected: null },
  { id: "H-cell-a11", split: "heldout", family: "cell", kind: "amount", raw: "$", expected: null },
  { id: "H-cell-a12", split: "heldout", family: "cell", kind: "amount", raw: "1,23", expected: null, acceptAlso: ["1.23"], ambiguous: true, note: "Decimal comma or malformed thousands." },
  { id: "H-cell-a13", split: "heldout", family: "cell", kind: "amount", raw: "−12.50", expected: "-12.50", acceptAlso: [null], note: "Unicode minus sign (U+2212): dropping it flips the sign silently." },
  { id: "H-cell-a14", split: "heldout", family: "cell", kind: "amount", raw: "2.345,67", expected: "2345.67", acceptAlso: [null], ambiguous: true },
  { id: "H-cell-a15", split: "heldout", family: "cell", kind: "amount", raw: "7-1", expected: null },
  { id: "H-cell-a16", split: "heldout", family: "cell", kind: "amount", raw: "1e400", expected: null, note: "Overflows to Infinity." },
  { id: "H-cell-a17", split: "heldout", family: "cell", kind: "amount", raw: "Rs. 2,500", expected: "2500" },
  { id: "H-cell-a18", split: "heldout", family: "cell", kind: "amount", raw: "#N/A", expected: null },
  { id: "H-cell-d01", split: "heldout", family: "cell", kind: "date", raw: "2023-11-09", expected: "2023-11-09" },
  { id: "H-cell-d02", split: "heldout", family: "cell", kind: "date", raw: "09/11/2023", expected: "2023-11-09", ambiguous: true, note: "Ambiguous order; DD/MM default." },
  { id: "H-cell-d03", split: "heldout", family: "cell", kind: "date", raw: "11/25/2023", expected: "2023-11-25" },
  { id: "H-cell-d04", split: "heldout", family: "cell", kind: "date", raw: "25-12-2023", expected: "2023-12-25" },
  { id: "H-cell-d05", split: "heldout", family: "cell", kind: "date", raw: "Dec 25, 2023", expected: "2023-12-25" },
  { id: "H-cell-d06", split: "heldout", family: "cell", kind: "date", raw: "25 Dec 2023", expected: "2023-12-25" },
  { id: "H-cell-d07", split: "heldout", family: "cell", kind: "date", raw: "2023-02-29", expected: null },
  { id: "H-cell-d08", split: "heldout", family: "cell", kind: "date", raw: "2024-06-31", expected: null },
  { id: "H-cell-d09", split: "heldout", family: "cell", kind: "date", raw: "31/06/2024", expected: null },
  { id: "H-cell-d10", split: "heldout", family: "cell", kind: "date", raw: "30/02/2024", expected: null },
  { id: "H-cell-d11", split: "heldout", family: "cell", kind: "date", raw: "abc 12", expected: null },
  { id: "H-cell-d12", split: "heldout", family: "cell", kind: "date", raw: "13/13/2024", expected: null },
  { id: "H-cell-d13", split: "heldout", family: "cell", kind: "date", raw: "2024-12-31T23:59:59", expected: "2024-12-31" },
  { id: "H-cell-d14", split: "heldout", family: "cell", kind: "date", raw: "12/12/2012", expected: "2012-12-12" },
  { id: "H-cell-d15", split: "heldout", family: "cell", kind: "date", raw: "00/00/0000", expected: null },
  { id: "H-cell-d16", split: "heldout", family: "cell", kind: "date", raw: "Apr 31, 2024", expected: null },
];

const cl = (id: string, kind: ClassifyCase["kind"], text: string, expected: string, extra: Partial<ClassifyCase> = {}): ClassifyCase =>
  ({ id, split: "heldout", family: "classify", kind, text, expected, ...extra });

const classify: ClassifyCase[] = [
  cl("H-cat-01", "category", "Trader Joe's grocery", "groceries"),
  cl("H-cat-02", "category", "McDonald's", "dining"),
  cl("H-cat-03", "category", "Lyft ride", "transport"),
  cl("H-cat-04", "category", "Hulu", "subscriptions"),
  cl("H-cat-05", "category", "Mortgage payment", "housing"),
  cl("H-cat-06", "category", "Broadband internet", "utilities"),
  cl("H-cat-07", "category", "Payroll deposit", "salary"),
  cl("H-cat-08", "category", "Dental clinic", "health"),
  cl("H-cat-09", "category", "Best Buy", "shopping"),
  cl("H-cat-10", "category", "Hotel Marriott", "travel"),
  cl("H-cat-11", "category", "Concert tickets", "entertainment"),
  cl("H-cat-12", "category", "Wire transfer", "transfer"),
  cl("H-cat-13", "category", "Late fee", "fees"),
  cl("H-cat-14", "category", "Cashback reward", "income"),
  cl("H-cat-15", "category", "Water bill", "utilities"),
  cl("H-cat-16", "category", "Waterfront hotel stay", "travel"),
  cl("H-cat-17", "category", "Rent-a-car Hertz", "transport"),
  cl("H-cat-18", "category", "Gas for the car", "transport"),
  cl("H-cat-19", "category", "Steam game purchase", "entertainment"),
  cl("H-cat-20", "category", "Parking garage", "transport"),
  cl("H-cat-21", "category", "Pharmacy CVS", "health"),
  cl("H-cat-22", "category", "Doordash", "dining"),
  cl("H-cat-23", "category", "Tip jar donation", "uncategorized"),
  cl("H-cat-24", "category", "Walmart", "groceries", { ambiguous: true, note: "Walmart sells groceries and general goods." }),
  cl("H-ac-01", "assetClass", "Equities", "equity"),
  cl("H-ac-02", "assetClass", "Common Stock", "equity"),
  cl("H-ac-03", "assetClass", "ETF", "equity"),
  cl("H-ac-04", "assetClass", "Government Bonds", "fixed_income"),
  cl("H-ac-05", "assetClass", "Corporate Debt", "fixed_income"),
  cl("H-ac-06", "assetClass", "T-Bill", "fixed_income"),
  cl("H-ac-07", "assetClass", "Checking Account", "cash"),
  cl("H-ac-08", "assetClass", "Cash & Equivalents", "cash"),
  cl("H-ac-09", "assetClass", "Real Estate Fund", "real_estate"),
  cl("H-ac-10", "assetClass", "Property", "real_estate"),
  cl("H-ac-11", "assetClass", "Silver", "commodity"),
  cl("H-ac-12", "assetClass", "Crude Oil", "commodity"),
  cl("H-ac-13", "assetClass", "Ethereum", "crypto"),
  cl("H-ac-14", "assetClass", "Venture Capital", "alternative"),
  cl("H-ac-15", "assetClass", "Crypto ETF", "crypto"),
  cl("H-ac-16", "assetClass", "Short-term Bond Fund", "fixed_income"),
  cl("H-ac-17", "assetClass", "Equity Index Fund", "equity"),
  cl("H-ac-18", "assetClass", "Hedge fund of funds", "alternative"),
  cl("H-ac-19", "assetClass", "Gold Miners ETF", "equity", { ambiguous: true, note: "Miners are equities; the metal is a commodity." }),
];

export const heldoutDataset: Dataset = {
  version: DATASET_VERSION,
  split: "heldout",
  pipeline: [...hand, ...randomCases(80, 20261004)],
  cells,
  classify,
};
