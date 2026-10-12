import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyzeFile, ForgeError, simulate, type ForgeReport, type ScenarioResult, type ScenarioSpec } from "../../src/index.js";
import { renderHoldingsCsv, renderTransactionsCsv } from "../csv.js";
import type { PipelineCase, ScenarioJson } from "../types.js";

export interface SimOutcome {
  spec: ScenarioSpec;
  result?: ScenarioResult;
  error?: { name: string; message: string; forge: boolean };
}

export interface Execution {
  case: PipelineCase;
  txnFile?: string;
  holdFile?: string;
  dataRows: { transactions?: number; holdings?: number };
  report?: ForgeReport;
  error?: { name: string; message: string; forge: boolean };
  sims: SimOutcome[];
  /** JSON of the model before / after all simulations (mutation check). */
  modelBefore?: string;
  modelAfter?: string;
}

const toSpec = (s: ScenarioJson): ScenarioSpec => {
  const spec: ScenarioSpec = {};
  if (s.incomePct !== undefined) spec.incomePct = Number(s.incomePct);
  if (s.expensePct !== undefined) spec.expensePct = Number(s.expensePct);
  if (s.recurringExpense) spec.recurringExpense = { amount: Number(s.recurringExpense.amount), category: s.recurringExpense.category };
  if (s.oneOffExpense) spec.oneOffExpense = { amount: Number(s.oneOffExpense.amount), category: s.oneOffExpense.category };
  return spec;
};

const errInfo = (e: unknown): { name: string; message: string; forge: boolean } => ({
  forge: e instanceof ForgeError,
  name: e instanceof Error ? e.constructor.name : "NonError",
  message: e instanceof Error ? e.message : String(e),
});

const countDataRows = (csv: string): number => Math.max(0, csv.split(/\r?\n/).filter((l) => l.trim() !== "").length - 1);

export const MISSING_FILE = "__missing__.csv";

/** Write the case's input files to a temp dir, run the real pipeline, then run its scenarios. */
export function execute(c: PipelineCase): Execution {
  const dir = mkdtempSync(join(tmpdir(), "forge-eval-"));
  const out: Execution = { case: c, dataRows: {}, sims: [] };
  try {
    const paths: string[] = [];
    const input = c.input ?? {};
    const wantsTxn = c.truth.txns.length > 0 || input.rawTransactionsCsv !== undefined || input.transactionsFileName !== undefined;
    if (wantsTxn) {
      const name = input.transactionsFileName ?? "transactions.csv";
      const text = renderTransactionsCsv(c.truth, input);
      const path = join(dir, name);
      if (name !== MISSING_FILE) writeFileSync(path, text, "utf8");
      out.txnFile = name;
      out.dataRows.transactions = countDataRows(text);
      paths.push(path);
    }
    if (c.truth.holdings.length > 0 || input.rawHoldingsCsv !== undefined) {
      const text = renderHoldingsCsv(c.truth, input);
      const path = join(dir, "holdings.csv");
      writeFileSync(path, text, "utf8");
      out.holdFile = "holdings.csv";
      out.dataRows.holdings = countDataRows(text);
      paths.push(path);
    }
    try {
      out.report = analyzeFile(paths);
    } catch (e) {
      out.error = errInfo(e);
      return out;
    }
    out.modelBefore = JSON.stringify(out.report.model);
    for (const s of c.scenarios ?? []) {
      const spec = toSpec(s);
      try {
        out.sims.push({ spec, result: simulate(out.report.model, spec, out.report.analyses) });
      } catch (e) {
        out.sims.push({ spec, error: errInfo(e) });
      }
    }
    out.modelAfter = JSON.stringify(out.report.model);
    return out;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
