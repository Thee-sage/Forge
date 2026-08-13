import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { writeTempCsv } from "../testkit.js";

/**
 * CLI robustness — spawns the real CLI so we assert on genuine exit codes and stderr.
 * Uses the installed tsx runtime to execute the TypeScript entrypoint directly.
 */
const TSX = join(process.cwd(), "node_modules/tsx/dist/cli.mjs");
const CLI = join(process.cwd(), "src/cli/index.ts");

interface CliResult {
  status: number;
  stdout: string;
  stderr: string;
}

function runCli(args: string[]): CliResult {
  try {
    const stdout = execFileSync(process.execPath, [TSX, CLI, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { status: 0, stdout, stderr: "" };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { status: e.status ?? 1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
}

const GOOD_CSV = `Date,Description,Amount,Category
2024-01-01,Salary,5000,salary
2024-01-05,Rent,-1500,housing
2024-02-01,Salary,5000,salary
2024-02-05,Rent,-1500,housing`;

const MIXED_CSV = `Date,Description,Amount,Currency
2024-01-01,Salary,5000,USD
2024-01-05,Food,-100,INR`;

describe("CLI error handling (exit codes + clean messages)", () => {
  it("nonexistent file → exit 1, clean message, no stack trace", () => {
    const r = runCli(["analyze", "definitely-not-here.csv"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/not found/i);
    expect(r.stderr).not.toMatch(/\bat \w+.*:\d+:\d+/); // no JS stack frames
  }, 30000);

  it("unsupported file type → exit 1 with a helpful message", () => {
    const bad = writeTempCsv("notes.txt", "just some text");
    const r = runCli(["analyze", bad]);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/unsupported/i);
  }, 30000);

  it("empty file → exit 1", () => {
    const empty = writeTempCsv("empty.csv", "");
    const r = runCli(["analyze", empty]);
    expect(r.status).toBe(1);
  }, 30000);

  it("mixed-currency dataset → exit 1, names the currencies", () => {
    const mixed = writeTempCsv("mixed.csv", MIXED_CSV);
    const r = runCli(["analyze", mixed]);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/multiple currencies/i);
  }, 30000);

  it("scenario with no spec → exit 1 with guidance", () => {
    const csv = writeTempCsv("s.csv", GOOD_CSV);
    const r = runCli(["scenario", csv]);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/no scenario/i);
  }, 30000);

  it("scenario with an invalid percent → exit 1", () => {
    const csv = writeTempCsv("s.csv", GOOD_CSV);
    const r = runCli(["scenario", csv, "--income", "abc"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/invalid percent/i);
  }, 30000);
});

describe("CLI success paths", () => {
  it("analyze → exit 0", () => {
    const csv = writeTempCsv("ok.csv", GOOD_CSV);
    const r = runCli(["analyze", csv]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/FORGE/);
  }, 30000);

  it("analyze --json → exit 0 and machine-readable JSON", () => {
    const csv = writeTempCsv("ok.csv", GOOD_CSV);
    const r = runCli(["analyze", csv, "--json"]);
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.model).toBeDefined();
    expect(Array.isArray(parsed.analyses)).toBe(true);
    expect(Array.isArray(parsed.insights)).toBe(true);
  }, 30000);
});
