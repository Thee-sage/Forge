/**
 * Cross-checks that a measurement's artefacts agree with each other.
 *
 *   npm run validate:accuracy:verify -- --dir evaluation/results/dataset-1.1.0
 *
 * A measurement is reported in four places — `report.json`, the rendered `REPORT.md`, the
 * baseline-vs-final `COMPARISON.md`, and the generated block in `docs/ACCURACY_VALIDATION.md`
 * — and they are written at different times by different commands. Nothing stopped them from
 * drifting apart, and a stale denominator or version stamp in the published document is
 * exactly the kind of error that makes every other number in it untrustworthy.
 *
 * This checks, for the held-out split (the measurement) and then for dev:
 *   1. baseline and final carry identical evaluator / oracle / rubric / dataset versions, so
 *      they are comparable at all (§11);
 *   2. each report's dataset hashes match the manifest it recorded;
 *   3. each report was taken from a *clean* checkout at a real commit, so it is reproducible
 *      — a measurement from a dirty tree cannot be re-derived from git;
 *   4. every headline denominator in report.json appears in REPORT.md, COMPARISON.md and the
 *      published document;
 *   5. denominators that differ between baseline and final are listed, because a rate over a
 *      changed denominator is not a like-for-like comparison even when both are valid.
 *
 * Exits non-zero on any failure. Missing fields throw rather than compare as `undefined`: a
 * check that cannot find its subject must fail loudly, not pass quietly.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (n: string, d: string): string => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1]! : d;
};

interface Headline { id: string; n: number; pass: number }
interface Split { split: string; headline: Headline[] }
interface Report {
  evaluator: { version: string; oracleVersion: string; rubricVersion: string; datasetVersion: string };
  environment: { forgeCommit: string; forgeSourceModified: boolean; generatedAt: string };
  integrity: { ok: boolean; datasetVersion: string; files: Record<string, { ok: boolean; expected: string; actual: string }> };
  splits: Split[];
  failures: { caseId: string; check: string; split: string }[];
}

const problems: string[] = [];
const note = (ok: boolean, msg: string): void => {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${msg}`);
  if (!ok) problems.push(msg);
};

function load(path: string): Report {
  const r = JSON.parse(readFileSync(path, "utf8")) as Report;
  if (!r.evaluator?.version || !r.environment?.forgeCommit || !Array.isArray(r.splits)) {
    throw new Error(`${path} is not a report.json this tool understands`);
  }
  return r;
}

function headlineOf(r: Report, split: string, label: string): Headline[] {
  const s = r.splits.find((x) => x.split === split);
  if (!s) throw new Error(`${label} has no "${split}" split`);
  for (const h of s.headline) {
    if (typeof h.n !== "number" || typeof h.pass !== "number") {
      throw new Error(`${label}: headline ${h.id} has no numeric n/pass — the report shape changed`);
    }
  }
  return s.headline;
}

const stamp = (r: Report): string =>
  `evaluator ${r.evaluator.version}, oracle ${r.evaluator.oracleVersion}, rubric ${r.evaluator.rubricVersion}, dataset ${r.evaluator.datasetVersion}`;

function main(): void {
  const dir = resolve(flag("dir", join(here, "results", "dataset-1.1.0")));
  const docPath = resolve(flag("doc", join(here, "..", "docs", "ACCURACY_VALIDATION.md")));

  const baseline = load(join(dir, "baseline", "report.json"));
  const final = load(join(dir, "final", "report.json"));
  const texts = {
    "REPORT.md": readFileSync(join(dir, "final", "REPORT.md"), "utf8"),
    "COMPARISON.md": readFileSync(join(dir, "COMPARISON.md"), "utf8"),
    [docPath.split(/[\\/]/).pop()!]: readFileSync(docPath, "utf8"),
  };

  console.log(`Verifying ${dir}\n`);

  console.log("1. Instrument versions");
  note(stamp(baseline) === stamp(final), `baseline and final agree: ${stamp(final)}`);
  if (stamp(baseline) !== stamp(final)) console.log(`        baseline: ${stamp(baseline)}`);

  console.log("\n2. Dataset integrity as each report recorded it");
  for (const [label, r] of [["baseline", baseline], ["final", final]] as const) {
    note(r.integrity.ok, `${label}: manifest ${r.integrity.datasetVersion}, all hashes match`);
    note(
      r.integrity.datasetVersion === r.evaluator.datasetVersion,
      `${label}: manifest version ${r.integrity.datasetVersion} matches evaluator's ${r.evaluator.datasetVersion}`,
    );
  }

  console.log("\n3. Reproducibility of each measurement");
  for (const [label, r] of [["baseline", baseline], ["final", final]] as const) {
    note(
      !r.environment.forgeSourceModified,
      `${label}: measured at ${r.environment.forgeCommit} from a clean tree` +
        (r.environment.forgeSourceModified ? " — IT WAS NOT; this run cannot be reproduced from git" : ""),
    );
  }

  for (const split of ["heldout", "dev"]) {
    console.log(`\n4. Denominators agree across every artefact — ${split}`);
    const fin = headlineOf(final, split, "final");
    for (const h of fin) {
      const where: string[] = [];
      for (const [name, text] of Object.entries(texts)) {
        // REPORT.md prints "passed / n"; the comparison and the document print n in its own column.
        const found = name === "REPORT.md"
          ? new RegExp(`\\|\\s*${h.id}\\s*\\|[^|]*\\|\\s*${h.pass}/${h.n}\\s*\\|`).test(text)
          : new RegExp(`\\|\\s*${h.id}\\s*\\|[^|]*\\|\\s*${h.n}\\s*\\|`).test(text);
        if (!found) where.push(name);
      }
      note(where.length === 0, `${split} ${h.id}: ${h.pass}/${h.n}${where.length ? ` missing from ${where.join(", ")}` : ""}`);
    }
  }

  console.log("\n5. Denominators that changed between baseline and final (reported, not a failure)");
  const bh = headlineOf(baseline, "heldout", "baseline");
  const fh = headlineOf(final, "heldout", "final");
  const moved = fh.filter((h) => bh.find((b) => b.id === h.id)?.n !== h.n);
  if (moved.length === 0) console.log("  none");
  for (const h of moved) {
    console.log(`  note  heldout ${h.id}: n ${bh.find((b) => b.id === h.id)!.n} -> ${h.n} (a rate over a changed denominator is not like-for-like)`);
  }

  console.log("\n6. Outstanding failures");
  console.log(`  baseline ${baseline.failures.length}, final ${final.failures.length}`);
  for (const f of final.failures) console.log(`  note  still failing: ${f.caseId} (${f.split}) ${f.check}`);

  console.log("");
  if (problems.length > 0) {
    console.error(`${problems.length} check(s) failed.`);
    process.exit(1);
  }
  console.log("All artefact cross-checks passed.");
}

main();
