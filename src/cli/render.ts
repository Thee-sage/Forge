import chalk from "chalk";
import { formatMoney, formatPercent, round } from "../core/money.js";
import type {
  AnalysisResult,
  Insight,
  Metric,
  Severity,
} from "../core/result.js";
import type { FinancialModel } from "../core/model.js";
import type { NormalizationReport } from "../normalize/index.js";
import type { ScenarioResult } from "../scenario/simulate.js";

/** Terminal rendering for the CLI. Pure formatting — no analysis logic here. */

const SEVERITY_STYLE: Record<Severity, (s: string) => string> = {
  info: chalk.green,
  notice: chalk.cyan,
  warning: chalk.yellow,
  critical: chalk.red,
};

const SEVERITY_ICON: Record<Severity, string> = {
  info: "✓",
  notice: "•",
  warning: "!",
  critical: "✕",
};

export function heading(text: string): string {
  return chalk.bold.underline(text);
}

export function formatMetric(m: Metric, currency: string): string {
  switch (m.unit) {
    case "currency":
      return formatMoney(m.value, currency);
    case "percent":
      return formatPercent(m.value);
    case "score":
      return `${Math.round(m.value)}/100`;
    case "count":
      return `${round(m.value, 1)}`;
    case "ratio":
      return m.value.toFixed(2);
    default:
      return String(round(m.value, 2));
  }
}

export function renderModelSummary(model: FinancialModel, report: NormalizationReport): string {
  const lines: string[] = [];
  lines.push(heading("Data Summary"));
  lines.push(
    `  Sources: ${chalk.dim(model.meta.sources.join(", "))}`,
  );
  lines.push(
    `  Transactions: ${chalk.bold(report.transactionsParsed)}   Holdings: ${chalk.bold(report.holdingsParsed)}   Skipped rows: ${report.rowsSkipped}`,
  );
  if (model.transactions.length > 0) {
    lines.push(
      `  Period: ${chalk.bold(model.period.start)} → ${chalk.bold(model.period.end)} (${model.period.months} months)   Currency: ${model.currency}`,
    );
  }
  if (report.warnings.length > 0) {
    lines.push(chalk.yellow(`  Warnings (${report.warnings.length}):`));
    for (const w of report.warnings) lines.push(chalk.yellow(`    - ${w}`));
  }
  return lines.join("\n");
}

export function renderAnalysis(result: AnalysisResult, currency: string): string {
  const lines: string[] = [];
  lines.push(heading(result.title));
  const shown = result.metrics.slice(0, 8);
  for (const m of shown) {
    lines.push(`  ${m.label.padEnd(28)} ${chalk.bold(formatMetric(m, currency))}`);
  }
  for (const f of result.findings) {
    const style = SEVERITY_STYLE[f.severity];
    lines.push(`  ${style(SEVERITY_ICON[f.severity])} ${style(f.message)}`);
  }
  return lines.join("\n");
}

export function renderInsights(insights: Insight[]): string {
  const lines: string[] = [];
  lines.push(heading("Reasoning — Why"));
  if (insights.length === 0) {
    lines.push(chalk.dim("  No notable insights surfaced from the current data."));
    return lines.join("\n");
  }
  for (const ins of insights) {
    const style = SEVERITY_STYLE[ins.severity];
    lines.push("");
    lines.push(`  ${style(SEVERITY_ICON[ins.severity])} ${chalk.bold(ins.headline)} ${chalk.dim(`(confidence ${(ins.confidence * 100).toFixed(0)}%)`)}`);
    lines.push(`    ${ins.explanation}`);
    if (ins.drivers.length > 0) {
      lines.push(chalk.dim(`    drivers: ${ins.drivers.join("; ")}`));
    }
    for (const e of ins.evidence.slice(0, 3)) {
      lines.push(chalk.dim(`      · ${e.label}: ${e.detail}`));
    }
  }
  return lines.join("\n");
}

export function renderScenario(scenario: ScenarioResult, currency: string): string {
  const lines: string[] = [];
  lines.push(heading(`Scenario — ${scenario.description}`));
  lines.push(`  ${scenario.explanation}`);
  lines.push("");
  lines.push(`  ${"Metric".padEnd(24)} ${"Baseline".padStart(14)} ${"Scenario".padStart(14)} ${"Δ".padStart(12)}`);
  lines.push(chalk.dim(`  ${"-".repeat(66)}`));
  for (const d of scenario.deltas) {
    const fmt = (v: number) => fmtByUnit(v, d.unit, currency);
    const deltaStr = fmtByUnit(d.delta, d.unit, currency);
    const colored = d.delta > 0 ? chalk.green(deltaStr) : d.delta < 0 ? chalk.red(deltaStr) : chalk.dim(deltaStr);
    lines.push(
      `  ${d.label.padEnd(24)} ${fmt(d.baseline).padStart(14)} ${fmt(d.scenario).padStart(14)} ${colored.padStart(12)}`,
    );
  }
  // A metric Forge could not compute on one side is shown as such, never as a zero.
  for (const u of scenario.unavailable) {
    lines.push(chalk.dim(`  ${u.label.padEnd(24)} ${"—".padStart(14)} ${"—".padStart(14)} ${"n/a".padStart(12)}  (${u.reason})`));
  }
  return lines.join("\n");
}

function fmtByUnit(v: number, unit: string | undefined, currency: string): string {
  switch (unit) {
    case "currency":
      return formatMoney(v, currency);
    case "percent":
      return formatPercent(v);
    case "score":
      return `${Math.round(v)}`;
    case "count":
      return round(v, 1).toString();
    default:
      return round(v, 2).toString();
  }
}

export function banner(): string {
  return chalk.bold.hex("#e8853a")("⚒  FORGE") + chalk.dim(" — Financial Reasoning Engine");
}
