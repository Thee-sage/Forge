/**
 * Forge accuracy evaluator.
 *
 *   npm run validate:accuracy                       # both splits -> evaluation/results/latest
 *   npm run validate:accuracy -- --label baseline --out evaluation/results/baseline
 *   npm run validate:accuracy -- --case D-an-006    # one case, verbose
 *   npm run validate:accuracy -- --strict           # exit 1 on any critical failure
 *
 * Every figure in the output is computed from this run; nothing is hard-coded.
 */
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cellChecks, classifyChecks } from "./runner/cells.js";
import { execute } from "./runner/execute.js";
import { groundingChecks } from "./runner/grounding.js";
import { insightChecks, ungradedEmissions } from "./runner/insight.js";
import { invariantChecks } from "./runner/invariants.js";
import { numericChecks } from "./runner/numeric.js";
import type { Check } from "./runner/records.js";
import { safetyChecks } from "./runner/safety.js";
import { summarize, type SplitSummary } from "./summary.js";
import { renderMarkdown } from "./markdown.js";
import { DATASET_VERSION, EVALUATOR_VERSION, ORACLE_VERSION, RUBRIC_VERSION, TARGET_RATE } from "./version.js";
import type { Dataset } from "./types.js";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const has = (name: string): boolean => args.includes(`--${name}`);

const sha = (s: string): string => createHash("sha256").update(s).digest("hex");

function loadDataset(split: "dev" | "heldout"): { ds: Dataset; sha256: string } {
  const text = readFileSync(join(here, "datasets", split, "dataset.json"), "utf8");
  return { ds: JSON.parse(text) as Dataset, sha256: sha(text) };
}

export interface IntegrityReport { ok: boolean; datasetVersion: string; files: Record<string, { expected: string; actual: string; ok: boolean }>; problems: string[] }

function integrity(shas: Record<string, string>): IntegrityReport {
  const manifest = JSON.parse(readFileSync(join(here, "datasets", "MANIFEST.json"), "utf8")) as { datasetVersion: string; files: Record<string, { sha256: string }> };
  const files: IntegrityReport["files"] = {};
  const problems: string[] = [];
  for (const [name, expected] of Object.entries(manifest.files)) {
    const actual = shas[name] ?? "(not loaded)";
    files[name] = { expected: expected.sha256, actual, ok: actual === expected.sha256 };
    if (actual !== expected.sha256) problems.push(`${name} does not match MANIFEST.json (dataset was modified after freezing)`);
  }
  if (manifest.datasetVersion !== DATASET_VERSION) problems.push(`MANIFEST datasetVersion ${manifest.datasetVersion} != evaluator DATASET_VERSION ${DATASET_VERSION}`);
  return { ok: problems.length === 0, datasetVersion: manifest.datasetVersion, files, problems };
}

function gitCommit(): string {
  try {
    return execSync("git rev-parse --short HEAD", { cwd: resolve(here, ".."), stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "unknown";
  }
}
function gitDirty(): boolean {
  try {
    return execSync("git status --porcelain -- src", { cwd: resolve(here, ".."), stdio: ["ignore", "pipe", "ignore"] }).toString().trim().length > 0;
  } catch {
    return false;
  }
}

function main(): void {
  const only = flag("case");
  const splitArg = flag("split") ?? "all";
  const label = flag("label") ?? "latest";
  const outDir = resolve(flag("out") ?? join(here, "results", "latest"));
  const verbose = has("verbose") || only !== undefined;

  const dev = loadDataset("dev");
  const held = loadDataset("heldout");
  const integ = integrity({ "dev/dataset.json": dev.sha256, "heldout/dataset.json": held.sha256 });
  if (!integ.ok) {
    console.error("DATASET INTEGRITY FAILURE:\n  " + integ.problems.join("\n  "));
    console.error("Regenerate with `npm run eval:build-datasets` only if the change is intentional (bump DATASET_VERSION and record why).");
    process.exit(2);
  }

  const splits: { name: "dev" | "heldout"; ds: Dataset }[] = [];
  if (splitArg === "all" || splitArg === "dev") splits.push({ name: "dev", ds: dev.ds });
  if (splitArg === "all" || splitArg === "heldout") splits.push({ name: "heldout", ds: held.ds });

  const summaries: SplitSummary[] = [];
  const allChecks: Check[] = [];
  const t0 = Date.now();

  for (const { name, ds } of splits) {
    const checks: Check[] = [];
    const ungraded: string[] = [];
    let pipeline = ds.pipeline;
    let cells = ds.cells;
    let classify = ds.classify;
    if (only) {
      pipeline = pipeline.filter((c) => c.id === only);
      cells = cells.filter((c) => c.id === only);
      classify = classify.filter((c) => c.id === only);
    }
    for (const c of pipeline) {
      const exec = execute(c);
      checks.push(...numericChecks(exec), ...insightChecks(exec), ...groundingChecks(exec), ...safetyChecks(exec), ...invariantChecks(exec));
      ungraded.push(...ungradedEmissions(exec));
      if (verbose) console.log(`[${name}] ${c.id}${exec.error ? `  (pipeline error: ${exec.error.name})` : ""}`);
    }
    for (const c of cells) checks.push(...cellChecks(c));
    for (const c of classify) checks.push(...classifyChecks(c));
    if (only && pipeline.length + cells.length + classify.length === 0) continue;
    allChecks.push(...checks);
    summaries.push(summarize(name, checks, { pipeline: pipeline.length, cells: cells.length, classify: classify.length }, ungraded));
  }

  if (only) {
    for (const c of allChecks) console.log(`  ${c.status.toUpperCase().padEnd(4)} ${c.category}/${c.check}  expected=${JSON.stringify(c.expected)} actual=${JSON.stringify(c.actual)}${c.detail ? `  (${c.detail})` : ""}`);
    return;
  }

  const failures = allChecks.filter((c) => c.status === "fail").map((c) => ({
    caseId: c.caseId, split: c.split, family: c.family, category: c.category, check: c.check, severity: c.severity, ambiguous: c.ambiguous,
    expected: c.expected, actual: c.actual, absError: c.absError, detail: c.detail,
    reproduce: `npm run validate:accuracy -- --case ${c.caseId}`,
  }));

  const report = {
    evaluator: {
      version: EVALUATOR_VERSION, oracleVersion: ORACLE_VERSION, rubricVersion: RUBRIC_VERSION, datasetVersion: DATASET_VERSION,
      targetRate: TARGET_RATE, label,
    },
    environment: { note: flag("note") ?? null, node: process.version, platform: process.platform, forgeCommit: gitCommit(), forgeSourceModified: gitDirty(), generatedAt: new Date().toISOString(), runtimeMs: Date.now() - t0 },
    integrity: integ,
    methods: {
      confidenceIntervals: "Wilson score interval, 95%, for every pass rate; bootstrap (percentile, 2000 resamples, fixed seed) for F1. Pass-rate intervals assume independent trials; checks within one case are correlated, so metric-level intervals are optimistic and case-level intervals should be preferred.",
      tolerances: "See evaluation/metrics.ts: currency abs 1e-6 + rel 1e-13; ratio abs 1e-10 + rel 1e-10; counts and scores exact.",
    },
    splits: summaries,
    failures,
  };

  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "report.json"), JSON.stringify(report, null, 2) + "\n");
  writeFileSync(join(outDir, "failures.json"), JSON.stringify(failures, null, 2) + "\n");
  writeFileSync(join(outDir, "REPORT.md"), renderMarkdown(report));

  const held2 = summaries.find((s) => s.split === "heldout");
  console.log(`Forge accuracy evaluation (${label}) - evaluator ${EVALUATOR_VERSION}, dataset ${DATASET_VERSION}`);
  for (const s of summaries) {
    console.log(`\n== ${s.split} (${s.cases.pipeline} pipeline cases, ${s.cases.cells} cells, ${s.cases.classify} classification items)`);
    for (const h of s.headline) {
      const pct = (x: number): string => (Number.isNaN(x) ? "n/a" : `${(x * 100).toFixed(1)}%`);
      console.log(`  ${h.id}  ${h.name.padEnd(58)} ${String(h.pass).padStart(4)}/${String(h.n).padEnd(4)} ${pct(h.rate).padStart(7)}  95% CI [${pct(h.ci.lower)}, ${pct(h.ci.upper)}]`);
    }
    console.log(`  critical failures: ${s.criticalFailures.length}`);
  }
  console.log(`\nWrote ${outDir}`);
  if (held2 === undefined && splitArg === "heldout") console.log("(no heldout split loaded)");
  if (has("strict") && allChecks.some((c) => c.status === "fail" && c.severity === "critical")) process.exit(1);
}

main();
