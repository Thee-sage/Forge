/**
 * Builds a **blind labelling pack** for a second, independent reviewer, and reconciles their
 * answers against the frozen labels.
 *
 *   npm run eval:label-pack -- --split heldout --out <dir>
 *   npm run eval:label-pack -- --reconcile <answers.csv>
 *
 * ACCURACY_VALIDATION §10 names single-labeller bias as the framework's biggest remaining
 * weakness: every label, rubric and oracle specification comes from one author who had read
 * Forge's source, and the dataset-1.1.0 cases were written by whoever wrote the fixes they
 * measure. That cannot be fixed from inside a session — it needs another person. What *can* be
 * prepared is everything that makes their review cheap, blind and measurable.
 *
 * The pack deliberately contains:
 *   - the source data of each case, rendered as a plain table;
 *   - the question, as the rubric phrases it, with the rubric clause that governs it;
 *   - an UNGRADED option, because a rubric that forces a call on a borderline case
 *     manufactures agreement.
 *
 * and deliberately omits:
 *   - the existing label,
 *   - anything Forge produced for the case,
 *   - the thresholds inside Forge.
 *
 * Reconciliation reports raw agreement and Cohen's kappa, and lists every disagreement. It
 * **never rewrites a label**: a disagreement is a question for the owner to adjudicate, and
 * silently adopting the second opinion would simply move the single-labeller problem rather
 * than measure it.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Dataset, PipelineCase, Split } from "./types.js";
import { DATASET_VERSION, RUBRIC_VERSION } from "./version.js";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (n: string, d?: string): string | undefined => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : d;
};

/** What each label key asks, in the rubric's own words (ACCURACY_VALIDATION §5). */
const QUESTIONS: Record<string, { question: string; rubric: string }> = {
  "insight:low-savings-driver": {
    question: "Should Forge report that a low savings rate is a driver of this household's position?",
    rubric: "TRUE when income > 0 and the savings rate is at or below 5% (including negative). FALSE when the savings rate is 15% or more, or there is no income. In between: UNGRADED.",
  },
  "insight:cashflow-decline-driver": {
    question: "Should Forge report that cash flow has declined, and explain why?",
    rubric: "TRUE when there are at least 4 active months and the recent half's mean monthly net is at or below half the earlier half's. FALSE when the recent half is no worse than the earlier, or there are fewer than 4 months. In between: UNGRADED.",
  },
  "insight:portfolio-concentration": {
    question: "Should Forge report that this portfolio is concentrated?",
    rubric: "TRUE when the non-cash HHI is 0.40 or more, or one non-cash holding is 50% or more of investments. FALSE when the non-cash HHI is 0.15 or less and every position is 25% or less, or there is no non-cash holding. In between: UNGRADED.",
  },
  "insight:thin-liquidity": {
    question: "Should Forge report that liquidity is thin?",
    rubric: "TRUE when holdings and spending are both present and cash covers 1.5 months or less of average outflow. FALSE when cash covers 4.5 months or more, or there are no holdings or no spending. In between: UNGRADED.",
  },
  "insight:anomaly-impact": {
    question: "Should Forge report that an unusual transaction materially affected this period?",
    rubric: "TRUE when a clear outlier is 20% or more of total outflow. FALSE when there is no clear outlier, or every outlier is under 5% of outflow. In between: UNGRADED.",
  },
  "insight:healthy-position": {
    question: "Should Forge report that this household is in a healthy position?",
    rubric: "TRUE when there are at least 3 months, savings of 30% or more, no negative month, runway of 3 months or more, and a non-cash HHI of 0.5 or less. FALSE when savings are under 10%, net is negative, or there are fewer than 3 months of data. In between: UNGRADED.",
  },
  "finding:cashflow.negative-months": {
    question: "Should Forge report that one or more months were cash-flow negative?",
    rubric: "TRUE when at least one active month has a negative net. FALSE when no month does.",
  },
  "finding:expenditure.concentrated": {
    question: "Should Forge report that spending is concentrated in one category?",
    rubric: "TRUE when one non-housing category is 50% or more of outflow. FALSE when the largest category is 25% or less. In between: UNGRADED.",
  },
};

const anomalyQuestion = (what: string): { question: string; rubric: string } => ({
  question: `Is the transaction "${what}" an anomaly — something a person reviewing this ledger would want flagged as unusual?`,
  rubric:
    "TRUE when it is a non-recurring outflow of 5x or more the median non-recurring outflow, with at least 5 outflows in the history. " +
    "FALSE when it is 1.5x the median or less, or recurring (an identical amount 3+ times), or regular spend in a category that appears in " +
    "most months and is ordinary for that category whatever its ratio to the median, or there are fewer than 5 outflows, or it is unusually SMALL. " +
    "Between 1.5x and 5x: UNGRADED, unless the recurring-category clause decides it.",
});

const trendQuestion = (category: string): { question: string; rubric: string } => ({
  question: `Should Forge report that monthly spending on "${category}" has risen?`,
  rubric: "TRUE when the recent monthly average is 1.5x the earlier half or more AND at least 25 currency units more. FALSE when it is within +/-10%. In between: UNGRADED.",
});

function questionFor(key: string): { question: string; rubric: string } {
  if (QUESTIONS[key]) return QUESTIONS[key]!;
  const [kind, ...rest] = key.split(":");
  const what = rest.join(":");
  if (kind === "anomaly") return anomalyQuestion(what);
  if (kind === "trend") return trendQuestion(what);
  return { question: `Should Forge emit "${key}" for this case?`, rubric: "See ACCURACY_VALIDATION.md §5." };
}

function renderCase(c: PipelineCase): string {
  const L: string[] = [];
  L.push(`### Case ${c.id}`);
  L.push("");
  L.push(`${c.description ?? ""}`);
  L.push("");
  const txns = c.truth?.txns ?? [];
  if (txns.length > 0) {
    L.push("| Date | Description | Category | Amount |");
    L.push("|---|---|---|---:|");
    for (const t of txns) L.push(`| ${t.date} | ${t.description} | ${t.category} | ${t.amount} |`);
    L.push("");
  }
  const holdings = c.truth?.holdings ?? [];
  if (holdings.length > 0) {
    L.push("| Symbol | Asset class | Value |");
    L.push("|---|---|---:|");
    for (const h of holdings) L.push(`| ${h.symbol} | ${h.assetClass} | ${h.value} |`);
    L.push("");
  }
  L.push(`Currency: ${c.truth?.currency ?? "USD"}`);
  L.push("");
  return L.join("\n");
}

function buildPack(split: Split, outDir: string): void {
  const ds = JSON.parse(readFileSync(join(here, "datasets", split, "dataset.json"), "utf8")) as Dataset;
  const labelled = ds.pipeline.filter((c) => c.labels && Object.keys(c.labels).length > 0);

  const doc: string[] = [];
  doc.push(`# Forge — blind labelling pack (${split}, dataset ${DATASET_VERSION}, rubric ${RUBRIC_VERSION})`);
  doc.push("");
  doc.push("You are being asked to judge, from the data alone, what a financial reasoning tool");
  doc.push("*should* report. This pack contains no output from the tool and no existing answers.");
  doc.push("");
  doc.push("For each question answer **TRUE** (it should be reported), **FALSE** (it must not be),");
  doc.push("or **UNGRADED**. Please use UNGRADED freely: it is the correct answer whenever the case");
  doc.push("sits near a boundary, and a forced call on a borderline case is worse than no call. The");
  doc.push("rubric clause is quoted under each question — judge by it, not by what you guess the");
  doc.push("tool does.");
  doc.push("");
  doc.push("Record answers in `answers.csv` (one row per question, already listed for you). Then:");
  doc.push("");
  doc.push("```bash");
  doc.push(`npm run eval:label-pack -- --reconcile <path-to-answers.csv>`);
  doc.push("```");
  doc.push("");
  doc.push("That reports agreement and lists disagreements. It does not change any label: where we");
  doc.push("disagree, the case is for the project owner to adjudicate, and the disagreement itself");
  doc.push("is the measurement we are missing.");
  doc.push("");

  const rows: string[] = ["case_id,label_key,answer_TRUE_FALSE_or_UNGRADED,reviewer_comment"];
  for (const c of labelled) {
    doc.push(renderCase(c));
    for (const key of Object.keys(c.labels!)) {
      const q = questionFor(key);
      doc.push(`**Q ${c.id} / ${key}**`);
      doc.push("");
      doc.push(q.question);
      doc.push("");
      doc.push(`> ${q.rubric}`);
      doc.push("");
      doc.push("Answer: `__________`");
      doc.push("");
      rows.push(`${c.id},${key},,`);
    }
    doc.push("---");
    doc.push("");
  }

  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "LABELLING-PACK.md"), doc.join("\n"));
  writeFileSync(join(outDir, "answers.csv"), rows.join("\n") + "\n");
  console.log(`Wrote ${outDir}`);
  console.log(`  ${labelled.length} cases, ${rows.length - 1} questions, no labels or Forge output included.`);
}

/** Cohen's kappa over the three-way {TRUE, FALSE, UNGRADED} judgement. */
function kappa(pairs: { a: string; b: string }[]): number {
  const cats = ["TRUE", "FALSE", "UNGRADED"];
  const n = pairs.length;
  if (n === 0) return NaN;
  const agree = pairs.filter((p) => p.a === p.b).length / n;
  let expected = 0;
  for (const c of cats) {
    expected += (pairs.filter((p) => p.a === c).length / n) * (pairs.filter((p) => p.b === c).length / n);
  }
  return expected === 1 ? NaN : (agree - expected) / (1 - expected);
}

function reconcile(answersPath: string): void {
  const text = readFileSync(resolve(answersPath), "utf8").trim().split(/\r?\n/);
  const header = text.shift();
  if (!header?.startsWith("case_id,label_key")) throw new Error("answers file must start with the header from answers.csv");

  const ours = new Map<string, string>();
  for (const split of ["dev", "heldout"] as const) {
    const ds = JSON.parse(readFileSync(join(here, "datasets", split, "dataset.json"), "utf8")) as Dataset;
    for (const c of ds.pipeline) {
      for (const [k, v] of Object.entries(c.labels ?? {})) ours.set(`${c.id}/${k}`, v ? "TRUE" : "FALSE");
    }
  }

  const pairs: { a: string; b: string }[] = [];
  const disagreements: string[] = [];
  let blank = 0;
  let unknown = 0;

  for (const line of text) {
    const [caseId, key, answerRaw] = line.split(",");
    const id = `${caseId}/${key}`;
    const answer = (answerRaw ?? "").trim().toUpperCase();
    if (answer === "") { blank++; continue; }
    if (!["TRUE", "FALSE", "UNGRADED"].includes(answer)) throw new Error(`${id}: answer "${answer}" is not TRUE, FALSE or UNGRADED`);
    const mine = ours.get(id);
    if (mine === undefined) { unknown++; console.log(`  note  ${id} is not a labelled item in dataset ${DATASET_VERSION} — skipped`); continue; }
    pairs.push({ a: mine, b: answer });
    if (mine !== answer) disagreements.push(`  ${id}: frozen ${mine}, reviewer ${answer}`);
  }

  const k = kappa(pairs);
  console.log(`\nReconciliation against dataset ${DATASET_VERSION}, rubric ${RUBRIC_VERSION}`);
  console.log(`  answered        ${pairs.length}` + (blank ? ` (${blank} left blank)` : ""));
  if (unknown) console.log(`  unrecognised    ${unknown}`);
  console.log(`  agreed          ${pairs.length - disagreements.length}`);
  console.log(`  disagreed       ${disagreements.length}`);
  console.log(`  raw agreement   ${pairs.length ? ((1 - disagreements.length / pairs.length) * 100).toFixed(1) + "%" : "n/a"}`);
  console.log(`  Cohen's kappa   ${Number.isNaN(k) ? "n/a" : k.toFixed(3)}`);
  if (disagreements.length > 0) {
    console.log("\nDisagreements — for the owner to adjudicate; no label has been changed:");
    for (const d of disagreements) console.log(d);
    console.log("\nIf adjudication changes any label, bump RUBRIC_VERSION or DATASET_VERSION as");
    console.log("appropriate, rebuild the datasets, and re-baseline: the labels are part of the");
    console.log("instrument, so changing one changes what every past report measured.");
  }
}

function main(): void {
  const answers = flag("reconcile");
  if (answers !== undefined) { reconcile(answers); return; }
  const split = (flag("split", "heldout") ?? "heldout") as Split;
  if (split !== "dev" && split !== "heldout") throw new Error(`--split must be dev or heldout`);
  buildPack(split, resolve(flag("out", join(here, "results", `label-pack-${split}`))!));
}

main();
