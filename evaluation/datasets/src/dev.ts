import type { CellCase, ClassifyCase, Dataset, PipelineCase } from "../../types.js";
import { H, T, household, mk, monthly, truth } from "./builders.js";
import { DATASET_VERSION } from "../../version.js";

/**
 * DEVELOPMENT split. These cases may be inspected, debugged against and used to motivate
 * fixes. The held-out split (heldout.ts) must never be used that way.
 * Labels follow the rubric in docs/ACCURACY_VALIDATION.md section 5.
 */
const c = mk("dev");

// Anomaly fixture helper: N varied "normal" outflows spread over Jan 2024.
const GROC = [42.1, 55.8, 47.25, 61.0, 39.9, 52.35, 48.7, 58.15, 44.6, 50.05, 53.4, 46.3];
const groceryLines = (vals: number[], prefix = "Groceries") =>
  vals.map((v, i) => `2024-01-${String((i % 27) + 2).padStart(2, "0")} -${v.toFixed(2)} groceries ${prefix} ${i + 1}`);

const pipeline: PipelineCase[] = [
  // ------------------------------------------------------------------ cashflow
  c({
    id: "D-cf-001", family: "cashflow", tags: ["aggregation", "hand-calculated"],
    description: "Three complete months, mixed categories; the reference worked example.",
    truth: truth(T(
      "2024-01-05 +5000 salary Salary", "2024-01-10 -1500 housing Rent", "2024-01-15 -400 groceries Groceries",
      "2024-02-05 +5000 salary Salary", "2024-02-10 -1500 housing Rent", "2024-02-15 -450 groceries Groceries", "2024-02-20 -120 dining Dining",
      "2024-03-05 +5200 salary Salary", "2024-03-10 -1500 housing Rent", "2024-03-15 -380.50 groceries Groceries", "2024-03-22 -75.25 transport Transport",
    )),
    hand: {
      "cashflow.inflow": 15200, "cashflow.outflow": 5925.75, "cashflow.net": 9274.25,
      "cashflow.savingsRate": 0.6101480263157895, "cashflow.avgMonthlyNet": 3091.4166666666665, "cashflow.months": 3,
    },
    labels: { "insight:low-savings-driver": false, "finding:cashflow.negative-months": false, "insight:thin-liquidity": false },
  }),
  c({
    id: "D-cf-002", family: "cashflow", tags: ["aggregation"],
    description: "Single month of data.",
    truth: truth(T("2024-05-01 +3000 salary Salary", "2024-05-04 -900 housing Rent", "2024-05-09 -150.40 groceries Groceries")),
    expect: { unavailable: ["trend.categoriesChanged"] },
  }),
  c({
    id: "D-cf-003", family: "cashflow", tags: ["zero-income", "abstention"],
    description: "Spending only, no income: savings rate is undefined and no health score may be issued.",
    truth: truth(T("2024-01-03 -500 housing Rent", "2024-02-03 -500 housing Rent", "2024-02-10 -85.40 groceries Groceries")),
    expect: { unavailable: ["cashflow.savingsRate", "health.score"] },
    labels: { "insight:low-savings-driver": false },
  }),
  c({
    id: "D-cf-004", family: "cashflow", tags: ["negative-net"],
    description: "Spending exceeds income overall; one month positive, two negative.",
    truth: truth(T(
      "2024-01-02 +2000 salary Salary", "2024-01-10 -1200 housing Rent", "2024-01-20 -300 groceries Groceries",
      "2024-02-02 +2000 salary Salary", "2024-02-10 -1800 housing Rent", "2024-02-20 -700 groceries Groceries",
      "2024-03-02 +2000 salary Salary", "2024-03-10 -1900 housing Rent", "2024-03-20 -450 groceries Groceries",
    )),
    labels: { "insight:low-savings-driver": true, "finding:cashflow.negative-months": true, "insight:healthy-position": false },
  }),
  c({
    id: "D-cf-005", family: "cashflow", tags: ["zero-outflow"],
    description: "Income only: savings rate exactly 1; expense ratio 0.",
    truth: truth(T("2024-01-31 +4000 salary Salary", "2024-02-29 +4000 salary Salary", "2024-03-31 +50.75 income Interest")),
  }),
  c({
    id: "D-cf-006", family: "cashflow", tags: ["refund"], ambiguous: true,
    note: "A refund can be modelled as spending reversal (outflow reduced) or as income. The Forge schema has only inflow/outflow, so the contract reading (refund = inflow) is primary; netting against spend is a valid alternative that changes inflow, outflow and savings rate but not net.",
    description: "A refund row (positive amount) alongside the purchase it reverses.",
    truth: truth(T("2024-01-02 +3000 salary Salary", "2024-01-05 -240 shopping Headphones", "2024-01-18 +240 income Refund headphones", "2024-01-20 -300 groceries Groceries")),
  }),
  c({
    id: "D-cf-007", family: "cashflow", tags: ["transfer"], ambiguous: true,
    note: "An own-account transfer is neither income nor spending. The schema has no transfer type, so both legs are counted (contract reading, primary). Excluding internal transfers is a valid alternative that changes inflow, outflow and savings rate but not net.",
    description: "A transfer to savings recorded as an outflow plus a matching inflow in the other account.",
    truth: truth(T("2024-01-02 +3000 salary Salary", "2024-01-06 -500 transfer Transfer to savings", "2024-01-06 +500 transfer Transfer from checking", "2024-01-20 -900 housing Rent")),
  }),
  c({
    id: "D-cf-008", family: "cashflow", tags: ["irregular-period", "calendar"], ambiguous: true,
    note: "months = whole calendar months from first to last date (documented). Months without transactions count toward avgMonthlyNet but are skipped by the stability and trend halves (active months only); averaging over active months only is a valid alternative.",
    description: "Activity in Jan, Apr and Sep only (empty months in between).",
    truth: truth(T(
      "2024-01-10 +2500 salary Salary", "2024-01-20 -1000 housing Rent",
      "2024-04-10 +2500 salary Salary", "2024-04-20 -1100 housing Rent",
      "2024-09-10 +2500 salary Salary", "2024-09-20 -1300 housing Rent",
    )),
  }),
  c({
    id: "D-cf-009", family: "cashflow", tags: ["calendar", "leap"],
    description: "Year boundary and leap day; first and last months are single-day months.",
    truth: truth(T(
      "2023-12-31 +1000 salary Salary", "2024-01-15 +1000 salary Salary", "2024-02-29 -250.10 groceries Leap day shop",
      "2024-02-29 -49.90 dining Leap day dinner", "2024-03-01 -75 transport Metro pass",
    )),
  }),
  c({
    id: "D-cf-010", family: "cashflow", tags: ["float-accumulation"],
    description: "200 outflows of 0.10: a naive float sum drifts; the exact total is 20.00.",
    truth: truth([
      ...T("2024-01-01 +100.00 salary Bonus"),
      ...Array.from({ length: 200 }, (_, i) => ({ date: `2024-01-${String((i % 27) + 1).padStart(2, "0")}`, amount: "-0.10", category: "misc", description: `Penny ${i + 1}` })),
    ]),
    hand: { "cashflow.inflow": 100, "cashflow.outflow": 20, "cashflow.net": 80, "cashflow.savingsRate": 0.8 },
  }),
  c({
    id: "D-cf-011", family: "cashflow", tags: ["large-values"],
    description: "Values around 1e9 with cents.",
    truth: truth(T("2024-01-15 +1234567890.12 salary Fund distribution", "2024-01-20 -234567890.12 housing Property", "2024-01-25 -1000000000.00 shopping Equipment")),
    hand: { "cashflow.inflow": 1234567890.12, "cashflow.outflow": 1234567890.12, "cashflow.net": 0 },
  }),
  c({
    id: "D-cf-012", family: "cashflow", tags: ["category-normalisation"],
    description: "Category cells differing only by case/whitespace must merge into one category.",
    truth: truth(T("2024-01-02 +2000 salary Salary", "2024-01-05 -100 groceries A", "2024-01-06 -200 groceries B", "2024-01-07 -300 groceries C", "2024-01-08 -50 dining D")),
    input: { categoryText: ["Salary", "Groceries", " groceries ", "GROCERIES", "Dining"] },
  }),
  c({
    id: "D-cf-013", family: "cashflow", tags: ["thin-margin"],
    description: "Income barely above spending: savings rate 3%.",
    truth: truth(monthly("2024-01", 3, (ym) => [`${ym}-01 +3000 salary Salary`, `${ym}-05 -1800 housing Rent`, `${ym}-12 -1110 groceries Living costs`])),
    labels: { "insight:low-savings-driver": true, "insight:healthy-position": false },
  }),

  // ------------------------------------------------------------------ formats (normalisation)
  c({
    id: "D-fmt-001", family: "format", tags: ["debit-credit"],
    description: "Separate Debit/Credit columns.",
    truth: truth(T("2024-01-05 +2500 salary Salary", "2024-01-09 -700.35 housing Rent", "2024-02-05 +2500 salary Salary", "2024-02-11 -88.88 dining Dinner")),
    input: { amountFormat: "debitcredit" },
  }),
  c({
    id: "D-fmt-002", family: "format", tags: ["parentheses"],
    description: "Accounting negatives in parentheses with thousands separators.",
    truth: truth(T("2024-01-05 +12500 salary Salary", "2024-01-09 -1700.35 housing Rent", "2024-02-05 +12500 salary Salary", "2024-02-11 -2088.88 dining Dinner")),
    input: { amountFormat: "parens" },
  }),
  c({
    id: "D-fmt-003", family: "format", tags: ["currency-symbol"],
    description: "Euro-prefixed amounts, no currency column: the dataset currency is EUR.",
    truth: truth(T("2024-01-05 +2500 salary Salary", "2024-01-09 -700.35 housing Rent"), [], "EUR"),
    input: { amountFormat: "symbol" },
  }),
  c({
    id: "D-fmt-004", family: "format", tags: ["dates", "dmy"],
    description: "DD/MM/YYYY dates containing a day > 12 (unambiguous).",
    truth: truth(T("2024-01-25 +2500 salary Salary", "2024-02-03 -700.35 housing Rent", "2024-03-15 -88.88 dining Dinner")),
    input: { dateFormat: "dmy" }, expect: { forbiddenWarnings: ["ambiguous"] },
  }),
  c({
    id: "D-fmt-005", family: "format", tags: ["dates", "mdy"],
    description: "MM/DD/YYYY dates containing a day > 12 (unambiguous US style).",
    truth: truth(T("2024-01-25 +2500 salary Salary", "2024-02-03 -700.35 housing Rent", "2024-03-15 -88.88 dining Dinner")),
    input: { dateFormat: "mdy" }, expect: { forbiddenWarnings: ["ambiguous"] },
  }),
  c({
    id: "D-fmt-006", family: "format", tags: ["dates", "long"],
    description: "Month-name dates.",
    truth: truth(T("2024-01-25 +2500 salary Salary", "2024-02-03 -700.35 housing Rent", "2024-03-15 -88.88 dining Dinner")),
    input: { dateFormat: "long" },
  }),
  c({
    id: "D-fmt-007", family: "format", tags: ["dates", "ambiguous-order"], ambiguous: true,
    note: "All day/month fields are <= 12, so DD/MM and MM/DD are both valid readings. Forge's documented default is DD/MM and it must warn; the truth uses DD/MM.",
    description: "Slash dates where no field exceeds 12.",
    truth: truth(T("2024-02-03 +2500 salary Salary", "2024-03-04 -700.35 housing Rent", "2024-04-05 -88.88 dining Dinner")),
    input: { dateFormat: "dmy" }, expect: { warnings: ["ambiguous"] },
  }),
  c({
    id: "D-fmt-008", family: "format", tags: ["dates", "conflict"],
    description: "One column mixes 13/02/2024 (DD/MM) and 02/13/2024 (MM/DD): contradictory, must warn.",
    truth: truth([]),
    input: { rawTransactionsCsv: "Date,Description,Amount,Category\n13/02/2024,A,-10.00,misc\n02/13/2024,B,-20.00,misc\n" },
    expect: { metrics: false, warnings: ["mixes|conflict|ambig"] },
  }),

  // ------------------------------------------------------------------ expenditure
  c({
    id: "D-ex-001", family: "expenditure", tags: ["ranking"],
    description: "Seven categories with distinct totals; checks totals, ranking and shares.",
    truth: truth(T(
      "2024-01-01 +9000 salary Salary", "2024-01-02 -2200 housing Rent", "2024-01-05 -610.40 groceries G1", "2024-01-09 -310.10 groceries G2",
      "2024-01-11 -480 transport T1", "2024-01-12 -150 dining D1", "2024-01-15 -95.5 dining D2", "2024-01-16 -300 utilities U1",
      "2024-01-17 -77.77 subscriptions S1", "2024-01-18 -640 travel V1", "2024-01-19 -33.33 fees F1",
    )),
    labels: { "finding:expenditure.concentrated": false },
  }),
  c({
    id: "D-ex-002", family: "expenditure", tags: ["ranking", "tie"],
    description: "Two categories tie exactly; rank-dependent metrics are not eligible (ordering undefined).",
    truth: truth(T("2024-01-01 +3000 salary Salary", "2024-01-02 -500 housing Rent", "2024-01-03 -500 groceries Food", "2024-01-04 -100 dining Out")),
  }),
  c({
    id: "D-ex-003", family: "expenditure", tags: ["categorisation", "inference"],
    description: "No category column: Forge infers categories from descriptions (human labels are the truth).",
    truth: truth(T(
      "2024-01-01 +4000 salary Salary ACME payroll", "2024-01-02 -1500 housing Monthly rent payment", "2024-01-05 -312.40 groceries Whole Foods Market",
      "2024-01-07 -18.50 dining Starbucks coffee", "2024-01-09 -45 transport Shell gas station", "2024-01-12 -15.99 subscriptions Netflix subscription",
      "2024-01-14 -62.10 utilities Electric bill", "2024-01-20 -210 health City Hospital copay",
    )),
    input: { omitCategory: true },
  }),
  c({
    id: "D-ex-004", family: "expenditure", tags: ["concentration"],
    description: "One non-housing category is 70% of spending.",
    truth: truth(T("2024-01-01 +5000 salary Salary", "2024-01-03 -1400 shopping Gear", "2024-01-04 -300 groceries G", "2024-01-05 -300 transport T")),
    labels: { "finding:expenditure.concentrated": true },
  }),

  // ------------------------------------------------------------------ trend
  c({
    id: "D-tr-001", family: "trend", tags: ["even-halves"],
    description: "Six months; dining rises from 100 to 220/month, groceries flat.",
    truth: truth(monthly("2024-01", 6, (ym, i) => [
      `${ym}-01 +5000 salary Salary`, `${ym}-03 -1500 housing Rent`, `${ym}-08 -400 groceries Groceries`, `${ym}-14 -${i < 3 ? 100 : 220} dining Dining`,
    ])),
    labels: { "trend:dining": true, "trend:groceries": false, "insight:cashflow-decline-driver": false },
  }),
  c({
    id: "D-tr-002", family: "trend", tags: ["odd-halves"],
    description: "Five months: halves of 2 and 3 months must be compared per month, not in total.",
    truth: truth([
      ...T("2024-01-01 +4000 salary Salary", "2024-02-01 +4000 salary Salary", "2024-03-01 +4000 salary Salary", "2024-04-01 +4000 salary Salary", "2024-05-01 +4000 salary Salary"),
      ...T("2024-01-10 -80 dining Dining", "2024-02-10 -120 dining Dining", "2024-03-10 -100 dining Dining", "2024-04-10 -100 dining Dining", "2024-05-10 -100 dining Dining"),
      ...T("2024-01-12 -50 transport Transit", "2024-02-12 -50 transport Transit", "2024-03-12 -130 transport Transit", "2024-04-12 -130 transport Transit", "2024-05-12 -130 transport Transit"),
    ]),
    labels: { "trend:dining": false, "trend:transport": true },
  }),
  c({
    id: "D-tr-003", family: "trend", tags: ["irregular-period"], ambiguous: true,
    note: "Forge compares halves of the ACTIVE months (months with at least one transaction). Treating the empty calendar months as zero-spend months is a valid alternative that changes every per-month average.",
    description: "Active months Jan, Feb, Aug, Sep with a long gap between.",
    truth: truth(T(
      "2024-01-05 +3000 salary Salary", "2024-02-05 +3000 salary Salary", "2024-08-05 +3000 salary Salary", "2024-09-05 +3000 salary Salary",
      "2024-01-15 -90 dining Dining", "2024-02-15 -110 dining Dining", "2024-08-15 -300 dining Dining", "2024-09-15 -300 dining Dining",
    )),
  }),
  c({
    id: "D-tr-004", family: "trend", tags: ["new-category"],
    description: "A category appears only in the recent half.",
    truth: truth(monthly("2024-01", 4, (ym, i) => [`${ym}-01 +4000 salary Salary`, `${ym}-02 -1200 housing Rent`, ...(i >= 2 ? [`${ym}-20 -600 travel Trip`] : [])])),
    labels: { "trend:travel": true },
  }),
  c({
    id: "D-tr-005", family: "trend", tags: ["flat"],
    description: "Identical months: nothing changed.",
    truth: truth(monthly("2024-01", 4, (ym) => [`${ym}-01 +4000 salary Salary`, `${ym}-02 -1200 housing Rent`, `${ym}-10 -350 groceries Food`])),
    labels: { "trend:groceries": false, "insight:cashflow-decline-driver": false },
  }),
  c({
    id: "D-tr-006", family: "trend", tags: ["decline", "spending-driven"],
    description: "Net cash flow falls by more than half because dining spending rises tenfold.",
    truth: truth(monthly("2024-01", 6, (ym, i) => [
      `${ym}-01 +5000 salary Salary`, `${ym}-03 -1500 housing Rent`, `${ym}-08 -400 groceries Groceries`, `${ym}-14 -${i < 3 ? 200 : 2000} dining Dining`,
    ])),
    labels: { "insight:cashflow-decline-driver": true, "trend:dining": true },
  }),
  c({
    id: "D-tr-007", family: "trend", tags: ["decline", "income-driven"],
    description: "Net cash flow falls because income halves; spending is flat. The decline is real but is NOT caused by rising spending.",
    truth: truth(monthly("2024-01", 6, (ym, i) => [
      `${ym}-01 +${i < 3 ? 5000 : 2500} salary Salary`, `${ym}-03 -1500 housing Rent`, `${ym}-08 -400 groceries Groceries`, `${ym}-14 -200 dining Dining`,
    ])),
    labels: { "insight:cashflow-decline-driver": true },
  }),

  // ------------------------------------------------------------------ anomaly (labels per transaction description)
  c({
    id: "D-an-001", family: "anomaly", tags: ["clear-outlier"],
    description: "Twelve ordinary grocery charges and one 900 surgery bill.",
    truth: truth(T("2024-01-01 +4000 salary Salary", ...groceryLines(GROC), "2024-01-28 -900 health Surgery bill")),
    labels: { "anomaly:Surgery bill": true, "anomaly:Groceries 4": false, "anomaly:Groceries 5": false, "insight:anomaly-impact": true, "insight:low-savings-driver": false },
  }),
  c({
    id: "D-an-002", family: "anomaly", tags: ["tight-cluster"],
    description: "Ten similar charges; no outlier exists.",
    truth: truth(T("2024-01-01 +3000 salary Salary", ...groceryLines([50, 51, 49, 52, 48, 50.5, 49.5, 53, 47, 51.5], "Beans"))),
    labels: { "anomaly:Beans 8": false, "anomaly:Beans 9": false, "anomaly:Beans 5": false, "insight:anomaly-impact": false },
  }),
  c({
    id: "D-an-003", family: "anomaly", tags: ["recurring"],
    description: "Rent of 1500 every month plus ordinary groceries: the rent is regular, not anomalous.",
    truth: truth(monthly("2024-01", 6, (ym, i) => [`${ym}-01 +5000 salary Salary`, `${ym}-02 -1500 housing Rent ${ym}`, `${ym}-10 -${(45 + i * 3.1).toFixed(2)} groceries Food ${i + 1}`])),
    labels: { "anomaly:Rent 2024-01": false, "anomaly:Rent 2024-04": false, "insight:anomaly-impact": false },
  }),
  c({
    id: "D-an-004", family: "anomaly", tags: ["short-history", "abstention"],
    description: "Only four outflows: too little history to call any of them an outlier.",
    truth: truth(T("2024-01-01 +3000 salary Salary", "2024-01-05 -30 groceries Small 1", "2024-01-06 -25 groceries Small 2", "2024-01-07 -28 groceries Small 3", "2024-01-09 -900 shopping Big thing")),
    labels: { "anomaly:Big thing": false, "insight:anomaly-impact": false },
  }),
  c({
    id: "D-an-005", family: "anomaly", tags: ["zero-variance"],
    description: "Eight identical 50.00 charges (a subscription): zero variance, nothing is an outlier.",
    truth: truth(T("2024-01-01 +3000 salary Salary", ...Array.from({ length: 8 }, (_, i) => `2024-01-${String(i + 2).padStart(2, "0")} -50.00 subscriptions Gym ${i + 1}`))),
    labels: { "anomaly:Gym 1": false, "anomaly:Gym 8": false, "insight:anomaly-impact": false },
  }),
  c({
    id: "D-an-006", family: "anomaly", tags: ["near-duplicate", "zero-mad"], ambiguous: true,
    note: "The documented rule divides by the median absolute deviation, which is 0 when most variable amounts are identical; the numeric flag set is then undefined. The LABEL (10.50 is 5% above its cluster and is not an outlier) is unambiguous.",
    description: "Variable spend is 10.00, 10.00, 10.50 plus a 100.00 bill three times (recurring): 10.50 is not an outlier.",
    truth: truth(T("2024-01-01 +3000 salary Salary", "2024-01-02 -10.00 dining Tea A", "2024-01-03 -10.00 dining Tea B", "2024-01-04 -10.50 dining Tea C", "2024-01-05 -100.00 utilities Bill A", "2024-02-05 -100.00 utilities Bill B", "2024-03-05 -100.00 utilities Bill C")),
    labels: { "anomaly:Tea C": false, "anomaly:Tea A": false, "insight:anomaly-impact": false },
  }),
  c({
    id: "D-an-007", family: "anomaly", tags: ["two-outliers"],
    description: "Two genuine one-offs among ordinary spending.",
    truth: truth(T("2024-01-01 +6000 salary Salary", ...groceryLines(GROC), "2024-01-27 -1200 shopping Laptop", "2024-01-28 -800 travel Flights")),
    labels: { "anomaly:Laptop": true, "anomaly:Flights": true, "anomaly:Groceries 2": false, "insight:anomaly-impact": true },
  }),
  c({
    id: "D-an-008", family: "anomaly", tags: ["recurring", "one-off"],
    description: "Rent 1500 x5 (recurring) and one 3000 deposit (a one-off).",
    truth: truth(T(
      "2024-01-01 +9000 salary Salary", "2024-01-02 -1500 housing Rent 1", "2024-02-02 -1500 housing Rent 2", "2024-03-02 -1500 housing Rent 3", "2024-04-02 -1500 housing Rent 4", "2024-05-02 -1500 housing Rent 5",
      "2024-02-10 -3000 housing Deposit", ...groceryLines(GROC.slice(0, 8)),
    )),
    labels: { "anomaly:Deposit": true, "anomaly:Rent 3": false, "insight:anomaly-impact": true },
  }),
  c({
    id: "D-an-009", family: "anomaly", tags: ["low-side"],
    description: "A 0.50 charge among ~50 charges: unusually SMALL is not an anomaly of the 'large charge' type.",
    truth: truth(T("2024-01-01 +3000 salary Salary", ...groceryLines(GROC.slice(0, 8)), "2024-01-29 -0.50 misc Sample")),
    labels: { "anomaly:Sample": false, "insight:anomaly-impact": false },
  }),
  c({
    id: "D-an-010", family: "anomaly", tags: ["largest-is-recurring"],
    description: "The largest outflow is a recurring 2000 rent; the only genuine outlier is a 400 dental bill (4.5% of spending).",
    truth: truth(T(
      "2024-01-01 +9000 salary Salary", "2024-01-02 -2000 housing Rent 1", "2024-02-02 -2000 housing Rent 2", "2024-03-02 -2000 housing Rent 3", "2024-04-02 -2000 housing Rent 4",
      ...groceryLines(GROC.slice(0, 10)), "2024-01-30 -400 health Dental",
    )),
    labels: { "anomaly:Dental": true, "insight:anomaly-impact": false },
  }),

  c({
    id: "D-an-011", family: "anomaly", tags: ["multi-category", "pooled-baseline"],
    description: "A normal household: groceries ~450/month, dining ~100, transport ~60. Monthly groceries are ordinary for this household and must not be flagged just because they dwarf dining and transport.",
    truth: truth(monthly("2024-01", 6, (ym, i) => [
      `${ym}-01 +6000 salary Salary`, `${ym}-03 -1800 housing Rent ${ym}`, `${ym}-08 -${(430 + i * 7.35).toFixed(2)} groceries Groceries ${i + 1}`,
      `${ym}-14 -${(88 + i * 4.1).toFixed(2)} dining Dining ${i + 1}`, `${ym}-20 -${(55 + i * 2.2).toFixed(2)} transport Transit ${i + 1}`,
    ])),
    labels: { "anomaly:Groceries 3": false, "anomaly:Groceries 6": false, "anomaly:Dining 2": false, "insight:anomaly-impact": false },
  }),

  // ------------------------------------------------------------------ portfolio
  c({
    id: "D-pf-001", family: "portfolio", tags: ["equal-weights", "hand-calculated"],
    description: "Four equal positions: HHI = 1/4, effective positions = 4.",
    truth: truth([], H("A 25000 equity", "B 25000 equity", "C 25000 equity", "D 25000 equity")),
    hand: { "concentration.hhi": 0.25, "concentration.effectivePositions": 4, "concentration.topWeight": 0.25, "concentration.top3Weight": 0.75, "concentration.positions": 4, "allocation.portfolioValue": 100000 },
  }),
  c({
    id: "D-pf-002", family: "portfolio", tags: ["single-position"],
    description: "One holding: HHI = 1.",
    truth: truth([], H("ONLY 5000 equity")),
    hand: { "concentration.hhi": 1, "concentration.effectivePositions": 1, "concentration.top3Weight": 1 },
  }),
  c({
    id: "D-pf-003", family: "portfolio", tags: ["cash-heavy"],
    description: "70% cash plus eight equal equities: cash must not register as concentration risk.",
    truth: truth([], H("CASH 70000 cash", ...Array.from({ length: 8 }, (_, i) => `E${i + 1} 3750 equity`))),
    labels: { "insight:portfolio-concentration": false },
  }),
  c({
    id: "D-pf-004", family: "portfolio", tags: ["dominant-position"],
    description: "One stock is 70% of the investments.",
    truth: truth([], H("BIG 70000 equity", "S1 10000 equity", "S2 10000 equity", "S3 10000 equity")),
    labels: { "insight:portfolio-concentration": true },
  }),
  c({
    id: "D-pf-005", family: "portfolio", tags: ["all-cash"],
    description: "A portfolio made only of cash.",
    truth: truth([], H("CHK 8000 cash", "SAV 12000 cash")),
    labels: { "insight:portfolio-concentration": false },
  }),
  c({
    id: "D-pf-006", family: "portfolio", tags: ["no-holdings", "abstention"],
    description: "Transactions only: portfolio metrics are unavailable (HHI of an empty portfolio is undefined).",
    truth: truth(T("2024-01-01 +3000 salary Salary", "2024-01-10 -900 housing Rent")),
    expect: { unavailable: ["concentration.hhi", "allocation.cashWeight"] },
  }),
  c({
    id: "D-pf-007", family: "portfolio", tags: ["many-positions"],
    description: "Twenty positions with graded sizes.",
    truth: truth([], H(...Array.from({ length: 20 }, (_, i) => `P${i + 1} ${1000 + i * 137} ${(["equity", "fixed_income", "real_estate", "commodity", "crypto"] as const)[i % 5]}`))),
    labels: { "insight:portfolio-concentration": false },
  }),
  c({
    id: "D-pf-008", family: "portfolio", tags: ["duplicate-symbol"], ambiguous: true,
    note: "The same ticker held in two accounts is one economic position. Forge treats every row as its own position (no aggregation by symbol), which lowers HHI. Both readings are defensible; the contract (one holding row = one position) is primary.",
    description: "VTI appears twice (two accounts).",
    truth: truth([], H("VTI 30000 equity", "VTI 30000 equity", "BND 40000 fixed_income")),
  }),
  c({
    id: "D-pf-009", family: "portfolio", tags: ["class-text"],
    description: "Asset-class cells use free text (Stocks, Bonds, Cash & Equivalents).",
    truth: truth([], H("A 40000 equity", "B 30000 fixed_income", "C 20000 cash", "D 10000 real_estate")),
    input: { holdingClassText: ["Stocks", "Bonds", "Cash & Equivalents", "Real Estate"] },
  }),
  c({
    id: "D-pf-010", family: "portfolio", tags: ["class-text", "wrapper"],
    description: "Fund wrappers: a money-market fund is cash; a bond ETF is fixed income; a gold ETF is a commodity.",
    truth: truth([], H("MMF 30000 cash", "BETF 30000 fixed_income", "GETF 20000 commodity", "EQ 20000 equity")),
    input: { holdingClassText: ["Money Market Fund", "Bond ETF", "Gold ETF", "Equity"] },
  }),
  c({
    id: "D-pf-011", family: "portfolio", tags: ["cash-top-position"],
    description: "Cash is the largest row (50%) but the investments are concentrated (60/40): the driver is NOT cash.",
    truth: truth(T("2024-01-01 +1000 salary Salary", "2024-01-02 -500 housing Rent"), H("CASH 500 cash", "A 300 equity", "B 200 equity")),
    labels: { "insight:portfolio-concentration": true },
  }),

  // ------------------------------------------------------------------ health / runway
  c({
    id: "D-hl-001", family: "health", tags: ["runway", "boundary"],
    description: "Cash equals exactly one month of average spending: runway = 1.0 (cap boundary is strict < 1).",
    truth: truth(monthly("2024-01", 3, (ym) => [`${ym}-01 +4000 salary Salary`, `${ym}-05 -2000 housing Rent`]), H("CASH 2000 cash", "ETF 18000 equity", "ETF2 20000 equity")),
    labels: { "insight:thin-liquidity": true },
  }),
  c({
    id: "D-hl-002", family: "health", tags: ["runway", "zero-cash"],
    description: "Holdings but no cash: runway 0.",
    truth: truth(monthly("2024-01", 3, (ym) => [`${ym}-01 +4000 salary Salary`, `${ym}-05 -2000 housing Rent`]), H("ETF 18000 equity", "ETF2 20000 equity")),
    labels: { "insight:thin-liquidity": true },
  }),
  c({
    id: "D-hl-003", family: "health", tags: ["runway", "large"],
    description: "Cash covers 24 months: liquidity sub-score saturates at 1.",
    truth: truth(monthly("2024-01", 3, (ym) => [`${ym}-01 +4000 salary Salary`, `${ym}-05 -2000 housing Rent`]), H("CASH 48000 cash", "ETF 20000 equity")),
    labels: { "insight:thin-liquidity": false },
  }),
  c({
    id: "D-hl-004", family: "health", tags: ["cap", "majority-negative"], ambiguous: true,
    note: "DECISIONS D8 and PROJECT_RULES say the score is capped at 55 when a MAJORITY of months are negative. The code caps only when fewer than 34% of months are non-negative (>= ~66% negative). With 3 of 5 months negative (60%) the documented rule caps and the implementation does not. Documentation and code disagree; the documented contract is the primary expectation.",
    description: "Five months, three negative.",
    truth: truth(T(
      "2024-01-01 +5000 salary Salary", "2024-01-05 -1000 housing Rent",
      "2024-02-01 +5000 salary Salary", "2024-02-05 -1000 housing Rent",
      "2024-03-01 +1000 salary Salary", "2024-03-05 -2500 housing Rent",
      "2024-04-01 +1000 salary Salary", "2024-04-05 -2500 housing Rent",
      "2024-05-01 +1000 salary Salary", "2024-05-05 -2500 housing Rent",
    ), H("CASH 30000 cash", "FUND1 40000 equity", "FUND2 40000 equity", "BOND 40000 fixed_income")),
  }),
  c({
    id: "D-hl-005", family: "health", tags: ["cap", "net-negative"],
    description: "Strong liquidity and diversification but spending exceeds income: score capped at 45.",
    truth: truth(monthly("2024-01", 4, (ym) => [`${ym}-01 +3000 salary Salary`, `${ym}-05 -3300 housing Rent`]), H("CASH 60000 cash", "E1 50000 equity", "E2 50000 equity", "B1 50000 fixed_income")),
  }),
  c({
    id: "D-hl-006", family: "health", tags: ["holdings-only", "abstention"],
    description: "Holdings with no transactions: no health score, runway unavailable.",
    truth: truth([], H("CASH 10000 cash", "ETF 30000 equity")),
    expect: { unavailable: ["health.score", "health.runwayMonths"] },
  }),
  c({
    id: "D-hl-007", family: "health", tags: ["strong"],
    description: "Six months, 42% savings, no negative month, 8+ months of cash, diversified.",
    truth: truth(monthly("2024-01", 6, (ym) => [`${ym}-01 +6000 salary Salary`, `${ym}-05 -2000 housing Rent`, `${ym}-12 -900 groceries Groceries`, `${ym}-20 -600 utilities Bills`]), H("CASH 30000 cash", "E1 20000 equity", "E2 20000 equity", "B1 20000 fixed_income", "R1 15000 real_estate")),
    labels: { "insight:healthy-position": true, "insight:low-savings-driver": false, "insight:thin-liquidity": false },
  }),
  c({
    id: "D-hl-008", family: "health", tags: ["insufficient-history", "abstention"],
    description: "One good month and nothing else: too little history to call finances 'on a strong footing'.",
    truth: truth(T("2024-01-01 +5000 salary Salary", "2024-01-05 -1000 housing Rent")),
    labels: { "insight:healthy-position": false },
  }),
  c({
    id: "D-hl-009", family: "health", tags: ["single-transaction", "abstention"],
    description: "A single transaction.",
    truth: truth(T("2024-01-01 +5000 salary Salary")),
    expect: { unavailable: ["trend.categoriesChanged", "anomaly.medianOutflow", "concentration.hhi"] },
    labels: { "insight:healthy-position": false, "insight:low-savings-driver": false },
  }),

  // ------------------------------------------------------------------ scenarios (shared 6-month household)
  ...(() => {
    const h = household("a");
    const base = { txns: h.txns, holdings: h.holdings };
    const mkS = (id: string, description: string, scenarios: NonNullable<PipelineCase["scenarios"]>, extra: Partial<PipelineCase> = {}): PipelineCase =>
      c({ id, family: "scenario", tags: ["scenario"], description, truth: truth(base.txns, base.holdings), scenarios, ...extra });
    return [
      mkS("D-sc-001", "Income -20%.", [{ incomePct: "-0.2" }]),
      mkS("D-sc-002", "Expenses +10%.", [{ expensePct: "0.1" }]),
      mkS("D-sc-003", "Combined: income -10%, expenses +5%.", [{ incomePct: "-0.1", expensePct: "0.05" }]),
      mkS("D-sc-004", "New recurring expense of 200 per month.", [{ recurringExpense: { amount: "200", category: "gym" } }]),
      mkS("D-sc-005", "One-off expense of 5000.", [{ oneOffExpense: { amount: "5000", category: "repairs" } }]),
      mkS("D-sc-006", "Empty scenario equals the baseline.", [{}]),
      mkS("D-sc-007", "All four levers at once.", [{ incomePct: "0.05", expensePct: "0.1", recurringExpense: { amount: "150", category: "gym" }, oneOffExpense: { amount: "2500", category: "repairs" } }]),
      mkS("D-sc-008", "Income -100%: score and savings rate become unavailable; no delta may be fabricated.", [{ incomePct: "-1" }]),
    ];
  })(),
  c({
    id: "D-sc-009", family: "scenario", tags: ["scenario", "missing-baseline"],
    description: "Baseline has no spending (so no runway); a scenario adds a one-off expense. The runway delta must not be computed against a fabricated baseline of 0.",
    truth: truth(monthly("2024-01", 2, (ym) => [`${ym}-01 +1000 salary Salary`]), H("CASH 6000 cash")),
    scenarios: [{ oneOffExpense: { amount: "1000", category: "repairs" } }],
  }),
  c({
    id: "D-sc-010", family: "scenario", tags: ["scenario", "irregular-period"], ambiguous: true,
    note: "'Recurring monthly expense' is applied by Forge to each month that contains data (documented in simulate.ts). Applying it to every calendar month of the period is a valid alternative.",
    description: "Recurring expense on a period with empty months.",
    truth: truth(T("2024-01-10 +2500 salary Salary", "2024-01-20 -1000 housing Rent", "2024-04-10 +2500 salary Salary", "2024-04-20 -1100 housing Rent", "2024-06-10 +2500 salary Salary", "2024-06-20 -1300 housing Rent"), H("CASH 5000 cash", "ETF 15000 equity")),
    scenarios: [{ recurringExpense: { amount: "300", category: "gym" } }],
  }),
  c({
    id: "D-sc-011", family: "safety", tags: ["scenario", "invalid-input"],
    description: "Out-of-range / non-finite scenario inputs must be rejected, not turned into negative or infinite amounts.",
    truth: truth(T("2024-01-01 +3000 salary Salary", "2024-01-10 -900 housing Rent")),
    scenarios: [{ incomePct: "-1.5" }, { expensePct: "-2" }, { recurringExpense: { amount: "Infinity", category: "x" } }, { oneOffExpense: { amount: "NaN", category: "x" } }],
    expect: { metrics: false, scenarioMustReject: true },
  }),

  // ------------------------------------------------------------------ data safety
  c({
    id: "D-sf-001", family: "safety", tags: ["currency"],
    description: "Rows tagged USD and EUR in one transactions file: must refuse to sum them.",
    truth: truth(T("2024-01-01 +100 salary A", "2024-01-02 -20 groceries B")),
    input: { currencyColumn: ["USD", "EUR"] }, expect: { metrics: false, error: "CurrencyMismatchError", warnings: ["Multiple currencies"] },
  }),
  c({
    id: "D-sf-002", family: "safety", tags: ["currency"],
    description: "USD transactions with INR holdings (holdings tagged via a Currency column).",
    truth: truth(T("2024-01-01 +100 salary A", "2024-01-02 -20 groceries B"), H("X 1000 equity")),
    input: { rawHoldingsCsv: "Symbol,Name,Asset Class,Quantity,Price,Value,Currency\nX,X,equity,1,1000,1000,INR\n" },
    expect: { metrics: false, error: "CurrencyMismatchError" },
  }),
  c({
    id: "D-sf-003", family: "safety", tags: ["currency", "symbols"],
    description: "Amount cells carry different currency symbols ($ and €) with no currency column: silently summing them would be a mixed-currency total.",
    truth: truth(T("2024-01-01 +100 salary A", "2024-01-02 -20 groceries B")),
    input: { rawTransactionsCsv: "Date,Description,Amount,Category\n2024-01-01,A,$100.00,salary\n2024-01-02,B,-€20.00,groceries\n" },
    expect: { metrics: false, abstain: { error: "CurrencyMismatchError", warning: "currenc" } },
  }),
  c({
    id: "D-sf-004", family: "safety", tags: ["skipped-rows"],
    description: "Missing date, zero amount, text amount: each skipped with a reason.",
    truth: truth(T("2024-01-01 +100 salary Good")),
    input: { rawTransactionsCsv: "Date,Description,Amount,Category\n2024-01-01,Good,100.00,salary\n,No date,-5.00,misc\n2024-01-02,Zero,0.00,misc\n2024-01-03,Text,N/A,misc\n" },
    expect: { skipped: [{ table: "transactions", row: 1, reason: "date" }, { table: "transactions", row: 2, reason: "amount" }, { table: "transactions", row: 3, reason: "amount" }] },
  }),
  c({
    id: "D-sf-005", family: "safety", tags: ["skipped-rows", "calendar"],
    description: "Impossible calendar dates (2024-02-30, 2024-13-01) must be rejected, not accepted as-is.",
    truth: truth(T("2024-01-01 +100 salary Good")),
    input: { rawTransactionsCsv: "Date,Description,Amount,Category\n2024-01-01,Good,100.00,salary\n2024-02-30,Impossible,-5.00,misc\n2024-13-01,Impossible month,-6.00,misc\n" },
    expect: { skipped: [{ table: "transactions", row: 1, reason: "date" }, { table: "transactions", row: 2, reason: "date" }] },
  }),
  c({
    id: "D-sf-006", family: "safety", tags: ["skipped-rows", "non-finite"],
    description: "Infinity / NaN / garbage amounts are rejected with a reason.",
    truth: truth(T("2024-01-01 +100 salary Good")),
    input: { rawTransactionsCsv: "Date,Description,Amount,Category\n2024-01-01,Good,100.00,salary\n2024-01-02,Inf,Infinity,misc\n2024-01-03,Nan,NaN,misc\n2024-01-04,Junk,1.2.3,misc\n" },
    expect: { skipped: [{ table: "transactions", row: 1, reason: "amount" }, { table: "transactions", row: 2, reason: "amount" }, { table: "transactions", row: 3, reason: "amount" }] },
  }),
  c({
    id: "D-sf-007", family: "safety", tags: ["skipped-rows", "holdings"],
    description: "Negative and zero holding values are skipped with reasons.",
    truth: truth([], H("OK 1000 equity")),
    input: { rawHoldingsCsv: "Symbol,Name,Asset Class,Quantity,Price,Value\nOK,OK,equity,1,1000,1000\nNEG,NEG,equity,1,-50,-50\nZERO,ZERO,equity,0,0,0\n" },
    expect: { skipped: [{ table: "holdings", row: 1, reason: "negative|non-positive" }, { table: "holdings", row: 2, reason: "non-positive|missing" }] },
  }),
  c({
    id: "D-sf-008", family: "safety", tags: ["ingestion"],
    description: "A file with a header and no data rows.",
    truth: truth([]),
    input: { rawTransactionsCsv: "Date,Description,Amount,Category\n" }, expect: { metrics: false, error: "IngestionError" },
  }),
  c({
    id: "D-sf-009", family: "safety", tags: ["ingestion"],
    description: "Unsupported file extension.",
    truth: truth([]),
    input: { rawTransactionsCsv: "Date,Amount\n2024-01-01,5\n", transactionsFileName: "statement.txt" }, expect: { metrics: false, error: "IngestionError" },
  }),
  c({
    id: "D-sf-010", family: "safety", tags: ["contradictory", "debit-credit"],
    description: "One row has both a Debit (100) and a Credit (40): contradictory. Silently keeping one and dropping the other loses data.",
    truth: truth([]),
    input: { rawTransactionsCsv: "Date,Description,Debit,Credit,Category\n2024-01-05,Both set,100.00,40.00,misc\n2024-01-06,Fine,10.00,,misc\n" },
    expect: { metrics: false, abstain: { row: { table: "transactions", index: 0 }, warning: "debit|credit" } },
  }),
  c({
    id: "D-sf-011", family: "safety", tags: ["currency", "unrecognised"],
    description: "Currency cell says 'Swiss Franc' (not recognised): silently assuming USD would corrupt totals.",
    truth: truth([]),
    input: { rawTransactionsCsv: "Date,Description,Amount,Category,Currency\n2024-01-05,Row,-100.00,misc,Swiss Franc\n2024-01-06,Row2,-10.00,misc,USD\n" },
    expect: { metrics: false, abstain: { error: "CurrencyMismatchError", row: { table: "transactions", index: 0 }, warning: "currenc" } },
  }),
  c({
    id: "D-sf-012", family: "safety", tags: ["contradictory", "holdings"],
    description: "Holding states quantity 10 x price 100 but value 5000: contradictory.",
    truth: truth([], H("X 5000 equity")),
    input: { rawHoldingsCsv: "Symbol,Name,Asset Class,Quantity,Price,Value\nX,X,equity,10,100,5000\n" },
    expect: { metrics: false, warnings: ["value|quantity|price|inconsisten|contradict"] },
  }),
  c({
    id: "D-sf-013", family: "safety", tags: ["duplicates"],
    declaredUnsupported: "Duplicate-transaction detection is a documented limitation (PROJECT_STATE: 'No duplicate-transaction detection'). Reported, never scored.",
    description: "The same transaction row appears twice.",
    truth: truth(T("2024-01-05 -50 groceries Same row")),
    input: { rawTransactionsCsv: "Date,Description,Amount,Category\n2024-01-05,Same row,-50.00,groceries\n2024-01-05,Same row,-50.00,groceries\n" },
    expect: { metrics: false, warnings: ["duplicate"] },
  }),
  c({
    id: "D-sf-014", family: "safety", tags: ["columns"],
    description: "No date column: every row is skipped and the data problem is stated.",
    truth: truth([]),
    input: { rawTransactionsCsv: "Description,Amount,Category\nA,-5.00,misc\nB,6.00,misc\n" },
    expect: { metrics: false, warnings: ["date column"], skipped: [{ table: "transactions", row: 0, reason: "date" }] },
  }),
  c({
    id: "D-sf-015", family: "safety", tags: ["columns"],
    description: "No amount/debit/credit column: table is skipped with an explicit warning.",
    truth: truth([]),
    input: { rawTransactionsCsv: "Date,Description,Category\n2024-01-01,A,misc\n" },
    expect: { metrics: false, warnings: ["amount"], skipped: [{ table: "transactions", row: 0, reason: "amount" }] },
  }),
];

const cells: CellCase[] = [
  { id: "D-cell-a01", split: "dev", family: "cell", kind: "amount", raw: "1234.56", expected: "1234.56" },
  { id: "D-cell-a02", split: "dev", family: "cell", kind: "amount", raw: "-1234.56", expected: "-1234.56" },
  { id: "D-cell-a03", split: "dev", family: "cell", kind: "amount", raw: "(1,234.56)", expected: "-1234.56" },
  { id: "D-cell-a04", split: "dev", family: "cell", kind: "amount", raw: "$1,234.56", expected: "1234.56" },
  { id: "D-cell-a05", split: "dev", family: "cell", kind: "amount", raw: "-$5.00", expected: "-5.00" },
  { id: "D-cell-a06", split: "dev", family: "cell", kind: "amount", raw: "€ 99.90", expected: "99.90" },
  { id: "D-cell-a07", split: "dev", family: "cell", kind: "amount", raw: "USD 500", expected: "500" },
  { id: "D-cell-a08", split: "dev", family: "cell", kind: "amount", raw: "+500", expected: "500" },
  { id: "D-cell-a09", split: "dev", family: "cell", kind: "amount", raw: ".50", expected: "0.50" },
  { id: "D-cell-a10", split: "dev", family: "cell", kind: "amount", raw: "1e3", expected: "1000", note: "Scientific notation as exported by spreadsheets." },
  { id: "D-cell-a11", split: "dev", family: "cell", kind: "amount", raw: "1.234,56", expected: "1234.56", acceptAlso: [null], ambiguous: true, note: "European grouping. Parsing as 1234.56 or rejecting are both safe; 1.23456 is wrong under every reading." },
  { id: "D-cell-a12", split: "dev", family: "cell", kind: "amount", raw: "1,5", expected: null, acceptAlso: ["1.5"], ambiguous: true, note: "Decimal comma or malformed thousands; 15 is not a plausible reading." },
  { id: "D-cell-a13", split: "dev", family: "cell", kind: "amount", raw: "1.2.3", expected: null },
  { id: "D-cell-a14", split: "dev", family: "cell", kind: "amount", raw: "5-3", expected: null },
  { id: "D-cell-a15", split: "dev", family: "cell", kind: "amount", raw: "abc", expected: null },
  { id: "D-cell-a16", split: "dev", family: "cell", kind: "amount", raw: "N/A", expected: null },
  { id: "D-cell-a17", split: "dev", family: "cell", kind: "amount", raw: "Infinity", expected: null },
  { id: "D-cell-a18", split: "dev", family: "cell", kind: "amount", raw: "0.00", expected: null, note: "Zero-value rows carry no movement and are skipped with a reason (documented)." },
  { id: "D-cell-a19", split: "dev", family: "cell", kind: "amount", raw: "12,34,567.00", expected: "1234567.00", note: "Indian digit grouping." },
  { id: "D-cell-a20", split: "dev", family: "cell", kind: "amount", raw: "Rs.500", expected: "500" },
  { id: "D-cell-a21", split: "dev", family: "cell", kind: "amount", raw: "5.00-", expected: "-5.00", ambiguous: true, note: "Trailing minus (accounting export style)." },
  { id: "D-cell-a22", split: "dev", family: "cell", kind: "amount", raw: "−5.00", expected: "-5.00", acceptAlso: [null], note: "Unicode minus sign (U+2212), common in PDF/Excel exports: dropping it flips the sign silently." },
  { id: "D-cell-d01", split: "dev", family: "cell", kind: "date", raw: "2024-03-15", expected: "2024-03-15" },
  { id: "D-cell-d02", split: "dev", family: "cell", kind: "date", raw: "2024-03-15T10:00:00Z", expected: "2024-03-15" },
  { id: "D-cell-d03", split: "dev", family: "cell", kind: "date", raw: "15/03/2024", expected: "2024-03-15" },
  { id: "D-cell-d04", split: "dev", family: "cell", kind: "date", raw: "03/15/2024", expected: "2024-03-15" },
  { id: "D-cell-d05", split: "dev", family: "cell", kind: "date", raw: "05/01/2024", expected: "2024-01-05", ambiguous: true, note: "Ambiguous order; DD/MM is Forge's documented default." },
  { id: "D-cell-d06", split: "dev", family: "cell", kind: "date", raw: "2024-02-30", expected: null },
  { id: "D-cell-d07", split: "dev", family: "cell", kind: "date", raw: "2024-13-01", expected: null },
  { id: "D-cell-d08", split: "dev", family: "cell", kind: "date", raw: "31/04/2024", expected: null },
  { id: "D-cell-d09", split: "dev", family: "cell", kind: "date", raw: "29/02/2024", expected: "2024-02-29" },
  { id: "D-cell-d10", split: "dev", family: "cell", kind: "date", raw: "29/02/2023", expected: null },
  { id: "D-cell-d11", split: "dev", family: "cell", kind: "date", raw: "Jan 5, 2024", expected: "2024-01-05" },
  { id: "D-cell-d12", split: "dev", family: "cell", kind: "date", raw: "5 January 2024", expected: "2024-01-05" },
  { id: "D-cell-d13", split: "dev", family: "cell", kind: "date", raw: "hello 5", expected: null },
  { id: "D-cell-d14", split: "dev", family: "cell", kind: "date", raw: "Feb 30, 2024", expected: null },
  { id: "D-cell-d15", split: "dev", family: "cell", kind: "date", raw: "15.03.2024", expected: "2024-03-15" },
  { id: "D-cell-d16", split: "dev", family: "cell", kind: "date", raw: "2024-00-10", expected: null },
  { id: "D-cell-d17", split: "dev", family: "cell", kind: "date", raw: "tomorrow", expected: null },
];

const cl = (id: string, kind: ClassifyCase["kind"], text: string, expected: string, extra: Partial<ClassifyCase> = {}): ClassifyCase =>
  ({ id, split: "dev", family: "classify", kind, text, expected, ...extra });

const classify: ClassifyCase[] = [
  cl("D-cat-01", "category", "Whole Foods Market", "groceries"),
  cl("D-cat-02", "category", "Starbucks coffee", "dining"),
  cl("D-cat-03", "category", "Uber ride to airport", "transport"),
  cl("D-cat-04", "category", "Uber Eats order", "dining"),
  cl("D-cat-05", "category", "Netflix monthly", "subscriptions"),
  cl("D-cat-06", "category", "Monthly rent", "housing"),
  cl("D-cat-07", "category", "Electric bill", "utilities"),
  cl("D-cat-08", "category", "ACME payroll", "salary"),
  cl("D-cat-09", "category", "City Hospital copay", "health"),
  cl("D-cat-10", "category", "Amazon order", "shopping"),
  cl("D-cat-11", "category", "Airbnb Lisbon", "travel"),
  cl("D-cat-12", "category", "Cinema tickets", "entertainment"),
  cl("D-cat-13", "category", "ATM withdrawal", "transfer"),
  cl("D-cat-14", "category", "Overdraft fee", "fees"),
  cl("D-cat-15", "category", "Credit card payment", "transfer", { note: "A card repayment is a transfer of money, not income." }),
  cl("D-cat-16", "category", "Interest charge", "fees"),
  cl("D-cat-17", "category", "Water park tickets", "entertainment"),
  cl("D-cat-18", "category", "Phone case", "shopping"),
  cl("D-cat-19", "category", "Zorblax Industries", "uncategorized"),
  cl("D-cat-20", "category", "Dividend payment", "income"),
  cl("D-cat-21", "category", "Costco wholesale", "groceries"),
  cl("D-cat-22", "category", "Spotify Premium", "subscriptions"),
  cl("D-ac-01", "assetClass", "Equity", "equity"),
  cl("D-ac-02", "assetClass", "Stocks", "equity"),
  cl("D-ac-03", "assetClass", "Mutual Fund", "equity"),
  cl("D-ac-04", "assetClass", "Bond", "fixed_income"),
  cl("D-ac-05", "assetClass", "Treasury Note", "fixed_income"),
  cl("D-ac-06", "assetClass", "Cash", "cash"),
  cl("D-ac-07", "assetClass", "Savings account", "cash"),
  cl("D-ac-08", "assetClass", "Money Market Fund", "cash"),
  cl("D-ac-09", "assetClass", "Real Estate", "real_estate"),
  cl("D-ac-10", "assetClass", "REIT", "real_estate"),
  cl("D-ac-11", "assetClass", "Gold", "commodity"),
  cl("D-ac-12", "assetClass", "Bitcoin", "crypto"),
  cl("D-ac-13", "assetClass", "Hedge Fund", "alternative"),
  cl("D-ac-14", "assetClass", "Private Equity", "alternative"),
  cl("D-ac-15", "assetClass", "Bond ETF", "fixed_income"),
  cl("D-ac-16", "assetClass", "Gold ETF", "commodity"),
  cl("D-ac-17", "assetClass", "Index Fund", "equity"),
  cl("D-ac-18", "assetClass", "Misc", "unknown"),
  cl("D-ac-19", "assetClass", "real_estate", "real_estate", { note: "snake_case enum text as exported by some systems" }),
];

export const devDataset: Dataset = { version: DATASET_VERSION, split: "dev", pipeline, cells, classify };
