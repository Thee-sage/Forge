/**
 * Baseline-vs-final comparison, generated from two report.json files and the frozen datasets.
 * Nothing here is typed by hand: every number is read from the reports or the datasets.
 *
 *   npm run validate:accuracy:compare
 *   npm run validate:accuracy:compare -- --baseline <dir> --latest <dir> --out <file.md> --update-docs
 *
 * Both reports must carry the same evaluator and dataset version; see the guard in main().
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { SplitSummary } from "./summary.js";
import type { Dataset } from "./types.js";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (n: string, d: string): string => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1]! : d;
};

interface Report {
  evaluator: { version: string; datasetVersion: string; label: string; targetRate: number };
  environment: { note?: string | null; forgeCommit: string; forgeSourceModified: boolean; generatedAt: string };
  splits: SplitSummary[];
  failures: { split: string; category: string; check: string; severity: string; ambiguous: boolean; caseId: string }[];
}

const load = (dir: string): Report => JSON.parse(readFileSync(join(resolve(dir), "report.json"), "utf8")) as Report;
const pct = (x: number): string => (Number.isNaN(x) ? "n/a" : `${(x * 100).toFixed(1)}%`);
const ci = (c: { lower: number; upper: number }): string => (Number.isNaN(c.lower) ? "" : `[${pct(c.lower)}, ${pct(c.upper)}]`);

function composition(): string {
  const L: string[] = [];
  L.push("#### Dataset composition (counts computed from the frozen JSON)");
  L.push("");
  const sets = (["dev", "heldout"] as const).map((s) => ({ s, ds: JSON.parse(readFileSync(join(here, "datasets", s, "dataset.json"), "utf8")) as Dataset }));
  const fams = [...new Set(sets.flatMap(({ ds }) => ds.pipeline.map((c) => c.family)))].sort();
  L.push(`| Family | ${sets.map(({ s }) => s).join(" | ")} |`);
  L.push(`|---|${sets.map(() => "---:").join("|")}|`);
  for (const f of fams) L.push(`| ${f} | ${sets.map(({ ds }) => ds.pipeline.filter((c) => c.family === f).length).join(" | ")} |`);
  const row = (name: string, fn: (ds: Dataset) => number): void => void L.push(`| **${name}** | ${sets.map(({ ds }) => fn(ds)).join(" | ")} |`);
  row("pipeline cases (total)", (ds) => ds.pipeline.length);
  row("of which interpretation-dependent", (ds) => ds.pipeline.filter((c) => c.ambiguous).length);
  row("of which declared unsupported (unscored)", (ds) => ds.pipeline.filter((c) => c.declaredUnsupported).length);
  row("with hand-calculated reference values", (ds) => ds.pipeline.filter((c) => c.hand).length);
  row("seeded random cases (oracle-only reference)", (ds) => ds.pipeline.filter((c) => c.family === "random").length);
  row("scenarios", (ds) => ds.pipeline.reduce((n, c) => n + (c.scenarios?.length ?? 0), 0));
  row("finding-type labels (true or false)", (ds) => ds.pipeline.reduce((n, c) => n + Object.keys(c.labels ?? {}).length, 0));
  row("single-cell parsing cases", (ds) => ds.cells.length);
  row("classification items", (ds) => ds.classify.length);
  L.push("");
  return L.join("\n");
}

function statements(last: Report): string {
  const L: string[] = [];
  const f = last.splits.find((s) => s.split === "heldout");
  L.push("#### Scoped statements the held-out evidence does and does not support");
  L.push("");
  if (!f) return L.join("\n");
  const target = pct(last.evaluator.targetRate);
  for (const h of f.headline) {
    if (h.n === 0) continue;
    const correlated = ["A1", "C1", "D1", "D2"].includes(h.id) ? " Checks within one case are correlated, so this interval is optimistic; prefer the per-case measures." : "";
    const base = `**${h.id} ${h.name}**: ${h.pass}/${h.n} = ${pct(h.rate)} (95% CI ${ci(h.ci)}) on the held-out synthetic benchmark.${correlated}`;
    if (h.meetsTarget && h.lowerBoundMeetsTarget) L.push(`- ${base} The point estimate and the lower confidence bound are both >= ${target}.`);
    else if (h.meetsTarget) L.push(`- ${base} The point estimate is >= ${target}, but the sample is too small for the lower confidence bound to reach it: **do not claim ${target}**; claim only the measured rate and interval.`);
    else L.push(`- ${base} **Target of ${target} not met.**`);
  }
  L.push("");
  L.push(`Critical failures on the held-out split: **${f.criticalFailures.length}**.`);
  L.push("");
  return L.join("\n");
}

export function renderComparison(base: Report, last: Report): string {
  const L: string[] = [];
  const noteOf = (r: Report): string => (r.environment.note ? ` Provenance: ${r.environment.note}` : "");
  const stamp = (r: Report): string => `evaluator ${r.evaluator.version}, dataset ${r.evaluator.datasetVersion}, Forge ${r.environment.forgeCommit}${r.environment.forgeSourceModified ? " (+ uncommitted)" : ""}, run ${r.environment.generatedAt}.${noteOf(r)}`;
  L.push(`Baseline: ${stamp(base)}`);
  L.push("");
  L.push(`Final: ${stamp(last)}`);
  L.push("");
  for (const split of ["heldout", "dev"]) {
    const b = base.splits.find((s) => s.split === split);
    const f = last.splits.find((s) => s.split === split);
    if (!b || !f) continue;
    L.push(`#### ${split === "heldout" ? "Held-out split (the measurement)" : "Dev split (used for debugging; not independent)"}`);
    L.push("");
    L.push(`| ID | Measure | n | Baseline | Final | Final 95% CI | Final >= ${pct(last.evaluator.targetRate)}? | CI lower >= target? |`);
    L.push("|---|---|---:|---:|---:|---|---|---|");
    for (const h of f.headline) {
      const bh = b.headline.find((x) => x.id === h.id);
      L.push(`| ${h.id} | ${h.name} | ${h.n} | ${bh ? pct(bh.rate) : "n/a"} | **${pct(h.rate)}** | ${ci(h.ci)} | ${h.n === 0 ? "n/a" : h.meetsTarget ? "yes" : "no"} | ${h.n === 0 ? "n/a" : h.lowerBoundMeetsTarget ? "yes" : "no"} |`);
    }
    L.push("");
    L.push(`Critical failures: baseline **${b.criticalFailures.length}**, final **${f.criticalFailures.length}**. Total failing checks: baseline ${base.failures.filter((x) => x.split === split).length}, final ${last.failures.filter((x) => x.split === split).length}.`);
    L.push("");
    const keyOf = (x: { category: string; check: string }): string => `${x.category}/${x.check.replace(/^scenario\d+\./, "scenario.")}`;
    const count = (r: Report, key: string): number => r.failures.filter((x) => x.split === split && keyOf(x) === key).length;
    const keys = [...new Set([...base.failures, ...last.failures].filter((x) => x.split === split).map(keyOf))];
    const rows = keys.map((k) => ({ k, b: count(base, k), f: count(last, k) })).sort((x, y) => y.b - x.b || y.f - x.f);
    L.push("<details><summary>Failing checks by category/check (baseline -> final)</summary>");
    L.push("");
    L.push("| Category / check | Baseline | Final |");
    L.push("|---|---:|---:|");
    for (const r of rows) L.push(`| ${r.k} | ${r.b} | ${r.f} |`);
    L.push("");
    L.push("</details>");
    L.push("");
  }
  L.push(composition());
  L.push(statements(last));
  return L.join("\n");
}

function main(): void {
  const base = load(flag("baseline", join(here, "results", "baseline")));
  const last = load(flag("latest", join(here, "results", "latest")));

  // Two reports are a comparison only when the instrument was the same for both (§11). A
  // cross-generation table would read as progress when part of it is just a changed ruler,
  // so refuse rather than render one. The composition block below is also computed from the
  // datasets as they are on disk now, which only describes reports of the current version.
  const stampOf = (r: Report): string => `evaluator ${r.evaluator.version}, dataset ${r.evaluator.datasetVersion}`;
  if (stampOf(base) !== stampOf(last)) {
    throw new Error(
      `Refusing to compare reports from different instruments: baseline is ${stampOf(base)}, latest is ${stampOf(last)}. ` +
        "Re-measure both with the current evaluator and dataset, and report each generation separately.",
    );
  }

  const md = renderComparison(base, last);
  const outPath = resolve(flag("out", join(here, "results", "COMPARISON.md")));
  writeFileSync(outPath, `# Baseline vs final\n\nGenerated by \`npm run validate:accuracy:compare\`.\n\n${md}\n`);
  if (args.includes("--update-docs")) {
    const docPath = resolve(here, "..", "docs", "ACCURACY_VALIDATION.md");
    const doc = readFileSync(docPath, "utf8");
    const begin = "<!-- BEGIN GENERATED RESULTS -->";
    const end = "<!-- END GENERATED RESULTS -->";
    const i = doc.indexOf(begin);
    const j = doc.indexOf(end);
    if (i < 0 || j < 0) throw new Error("docs/ACCURACY_VALIDATION.md is missing the generated-results markers");
    writeFileSync(docPath, `${doc.slice(0, i + begin.length)}\n\n${md}\n${doc.slice(j)}`);
    console.log("Updated docs/ACCURACY_VALIDATION.md");
  }
  console.log(`Wrote ${outPath}`);
}

main();
