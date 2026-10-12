#!/usr/bin/env node
import { Command } from "commander";
import chalk from "chalk";
import { analyzeFile } from "../index.js";
import { ForgeError } from "../core/errors.js";
import { ingest } from "../ingestion/index.js";
import { normalize } from "../normalize/index.js";
import { runAnalyses } from "../analysis/index.js";
import { simulate, type ScenarioSpec } from "../scenario/simulate.js";
import {
  banner,
  renderAnalysis,
  renderInsights,
  renderModelSummary,
  renderScenario,
} from "./render.js";

const program = new Command();

program
  .name("forge")
  .description("Forge — a modular Financial Reasoning Engine (CSV/Excel → explainable insights)")
  .version("0.1.0");

program
  .command("analyze")
  .description("Run the full pipeline: ingest → normalize → analyze → reason")
  .argument("<files...>", "one or more CSV/Excel files (e.g. transactions + holdings)")
  .option("-c, --currency <code>", "default currency when the file omits one", "USD")
  .option("--json", "output raw JSON instead of formatted text")
  .action((files: string[], opts: { currency: string; json?: boolean }) => {
    run(() => {
      const report = analyzeFile(files, { defaultCurrency: opts.currency });
      if (opts.json) {
        console.log(JSON.stringify(report, null, 2));
        return;
      }
      const cur = report.model.currency;
      console.log(banner() + "\n");
      console.log(renderModelSummary(report.model, report.normalization) + "\n");
      for (const a of report.analyses) {
        console.log(renderAnalysis(a, cur) + "\n");
      }
      console.log(renderInsights(report.insights));
    });
  });

program
  .command("inspect")
  .description("Show detected format and the normalized model without full analysis")
  .argument("<files...>", "one or more CSV/Excel files")
  .option("-c, --currency <code>", "default currency when the file omits one", "USD")
  .option("--json", "output raw JSON instead of formatted text")
  .action((files: string[], opts: { currency: string; json?: boolean }) => {
    run(() => {
      const tables = files.flatMap((f) => ingest(f));
      const { model, report } = normalize(tables, { defaultCurrency: opts.currency });
      if (opts.json) {
        console.log(JSON.stringify({ tables: tables.map(summarizeTable), model, report }, null, 2));
        return;
      }
      console.log(banner() + "\n");
      for (const t of tables) {
        console.log(
          `  ${chalk.bold(t.name)} — shape: ${chalk.cyan(t.shape)}, ${t.rows.length} rows`,
        );
        console.log(chalk.dim(`    columns: ${t.headers.join(", ")}`));
      }
      console.log("");
      console.log(renderModelSummary(model, report));
    });
  });

program
  .command("scenario")
  .description("Simulate a what-if and report the projected impact")
  .argument("<files...>", "one or more CSV/Excel files")
  .option("-c, --currency <code>", "default currency when the file omits one", "USD")
  .option("--income <pct>", "percent change to income, e.g. -20 or 10")
  .option("--expense <pct>", "percent change to spending, e.g. 15")
  .option("--add-monthly <amount:category>", "add a recurring monthly expense, e.g. 500:rent")
  .option("--oneoff <amount:category>", "add a one-off expense, e.g. 3000:medical")
  .option("--json", "output raw JSON instead of formatted text")
  .action(
    (
      files: string[],
      opts: {
        currency: string;
        income?: string;
        expense?: string;
        addMonthly?: string;
        oneoff?: string;
        json?: boolean;
      },
    ) => {
      run(() => {
        const tables = files.flatMap((f) => ingest(f));
        const { model } = normalize(tables, { defaultCurrency: opts.currency });
        const baseline = runAnalyses(model);

        const spec: ScenarioSpec = {};
        if (opts.income !== undefined) spec.incomePct = parsePct(opts.income);
        if (opts.expense !== undefined) spec.expensePct = parsePct(opts.expense);
        if (opts.addMonthly) spec.recurringExpense = parseExpense(opts.addMonthly);
        if (opts.oneoff) spec.oneOffExpense = parseExpense(opts.oneoff);

        if (Object.keys(spec).length === 0) {
          fail(
            "No scenario specified. Use --income, --expense, --add-monthly, or --oneoff. Example: forge scenario data.csv --income -20",
          );
        }

        const result = simulate(model, spec, baseline);
        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }
        console.log(banner() + "\n");
        console.log(renderScenario(result, model.currency));
      });
    },
  );

program
  .command("serve")
  .description("Start the Forge web interface (upload files in the browser, same engine)")
  .option("-p, --port <number>", "port to listen on", "4173")
  .option("-h, --host <address>", "address to bind", "127.0.0.1")
  .action(async (opts: { port: string; host: string }) => {
    const port = Number.parseInt(opts.port, 10);
    if (!Number.isInteger(port) || port < 0 || port > 65535) {
      fail(`Invalid port: "${opts.port}"`);
    }
    try {
      const { startForgeServer } = await import("../web/server.js");
      const server = await startForgeServer(port, opts.host);
      console.log(banner() + "\n");
      console.log(`  ${chalk.bold("Forge web")} listening on ${chalk.cyan(`http://${opts.host}:${server.port}`)}`);
      console.log(chalk.dim("  Analysis runs in this process; nothing is persisted. Ctrl-C to stop.\n"));
    } catch (err) {
      if (err instanceof ForgeError) fail(err.message);
      fail(`Could not start the server: ${(err as Error).message}`);
    }
  });

program.parseAsync(process.argv);

// --- helpers -------------------------------------------------------------

function run(fn: () => void): void {
  try {
    fn();
  } catch (err) {
    // Expected, user-facing failures render as a clean message + exit 1.
    if (err instanceof ForgeError) fail(err.message);
    // Anything else is an unexpected bug — still no raw stack trace to the user.
    else fail(`Unexpected error: ${(err as Error).message}`);
  }
}

function fail(message: string): never {
  console.error(chalk.red(`✕ ${message}`));
  process.exit(1);
}

/** Parse a percent string ("-20", "10%", "-0.2") into a fraction (-0.2, 0.1, -0.2). */
function parsePct(raw: string): number {
  const s = raw.trim().replace("%", "");
  const n = Number.parseFloat(s);
  if (!Number.isFinite(n)) fail(`Invalid percent value: "${raw}"`);
  // Treat |n| <= 1 with no percent sign as already-a-fraction; else divide by 100.
  return Math.abs(n) <= 1 && !raw.includes("%") ? n : n / 100;
}

/** Parse "amount:category" into a scenario expense. */
function parseExpense(raw: string): { amount: number; category: string } {
  const [amountStr, ...rest] = raw.split(":");
  const amount = Number.parseFloat((amountStr ?? "").trim());
  if (!Number.isFinite(amount)) fail(`Invalid expense amount in "${raw}" (expected amount:category)`);
  const category = rest.join(":").trim() || "other";
  return { amount, category };
}

function summarizeTable(t: { name: string; shape: string; headers: string[]; rows: unknown[] }) {
  return { name: t.name, shape: t.shape, columns: t.headers, rowCount: t.rows.length };
}
