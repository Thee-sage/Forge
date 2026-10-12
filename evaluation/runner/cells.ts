import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ingest, normalize } from "../../src/index.js";
import { categorize, classifyAssetClass } from "../../src/normalize/index.js";
import { Rat } from "../rational.js";
import type { CellCase, ClassifyCase } from "../types.js";
import { mkCheck, type Check } from "./records.js";

const q = (s: string): string => `"${s.replace(/"/g, '""')}"`;

interface Observed { accepted: boolean; signed?: number; date?: string; recorded: boolean }

/** Push one raw cell through the real ingestion + normalisation (SheetJS included) and observe the outcome. */
export function observeCell(c: CellCase): Observed {
  const dir = mkdtempSync(join(tmpdir(), "forge-cell-"));
  try {
    const csv = c.kind === "amount"
      ? `Date,Description,Amount\n2024-01-15,Cell,${q(c.raw)}\n`
      : `Date,Description,Amount\n${q(c.raw)},Cell,-5.00\n`;
    const path = join(dir, "cell.csv");
    writeFileSync(path, csv, "utf8");
    const { model, report } = normalize(ingest(path));
    const t = model.transactions[0];
    if (!t) return { accepted: false, recorded: report.skippedRows.length > 0 };
    return { accepted: true, signed: t.direction === "outflow" ? -t.amount : t.amount, date: t.date, recorded: true };
  } catch {
    return { accepted: false, recorded: true };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function cellChecks(c: CellCase): Check[] {
  const meta = { id: c.id, split: c.split, family: "cell", ambiguous: Boolean(c.ambiguous) };
  const obs = observeCell(c);
  const acceptable = [c.expected, ...(c.acceptAlso ?? [])];
  const out: Check[] = [];
  if (!obs.accepted) {
    const okReject = acceptable.includes(null);
    out.push(mkCheck(meta, "cell", `${c.kind}`, okReject ? "pass" : "fail", "major", { expected: c.expected, actual: "rejected", detail: okReject ? undefined : "a valid cell was rejected (data loss, though recorded)" }));
    out.push(mkCheck(meta, "cell", `${c.kind}:rejection-recorded`, obs.recorded ? "pass" : "fail", "critical", { actual: obs.recorded ? "skipped row recorded" : "silently dropped" }));
    return out;
  }
  const actual = c.kind === "amount" ? obs.signed! : obs.date!;
  const match = acceptable.some((exp) => {
    if (exp === null) return false;
    return c.kind === "amount" ? Math.abs(Number(actual) - Rat.dec(exp).toNumber()) <= 1e-9 : actual === exp;
  });
  out.push(mkCheck(meta, "cell", `${c.kind}`, match ? "pass" : "fail", "critical", {
    expected: c.expected, actual, detail: match ? undefined : "a value that is neither the correct reading nor a safe rejection was accepted (silent corruption)",
  }));
  return out;
}

export function classifyChecks(c: ClassifyCase): Check[] {
  const meta = { id: c.id, split: c.split, family: "classify", ambiguous: Boolean(c.ambiguous) };
  const actual = c.kind === "category" ? categorize(c.text).category : classifyAssetClass(c.text);
  return [mkCheck(meta, "classify", c.kind, actual === c.expected ? "pass" : "fail", "major", { expected: c.expected, actual, detail: c.text })];
}
