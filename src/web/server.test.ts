import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startForgeServer } from "./server.js";

/**
 * End-to-end tests over the real HTTP surface: a file goes in as bytes and a finished
 * view comes back. They also pin the failure contract — an expected `ForgeError`
 * (mixed currencies, unsupported file) must surface as a clean message and a named kind,
 * never a stack trace (PROJECT_RULES §10).
 */

let base = "";
let close: () => Promise<void>;

beforeAll(async () => {
  const server = await startForgeServer(0);
  base = `http://127.0.0.1:${server.port}`;
  close = server.close;
});

afterAll(async () => {
  await close();
});

function upload(files: { name: string; content: string }[]) {
  return fetch(`${base}/api/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      files: files.map((f) => ({ name: f.name, base64: Buffer.from(f.content, "utf8").toString("base64") })),
    }),
  });
}

const TRANSACTIONS = [
  "Date,Description,Amount,Category",
  "2024-01-01,Salary,5000,salary",
  "2024-01-06,Rent,-1800,housing",
  "2024-02-01,Salary,5000,salary",
  "2024-02-06,Rent,-1800,housing",
  "2024-02-14,Groceries,-620,food",
  "2024-03-01,Salary,5000,salary",
  "2024-03-06,Rent,-1800,housing",
  "2024-03-21,Car repair,-4100,transport",
].join("\n");

const HOLDINGS = [
  "Symbol,Name,Asset Class,Quantity,Price",
  "NVDA,NVIDIA Corp,equity,80,1180",
  "BND,Bond Fund,fixed_income,100,72",
].join("\n");

describe("forge web server", () => {
  it("serves the client shell", async () => {
    const res = await fetch(base + "/");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toContain("/app.js");
  });

  it("analyses uploaded files and returns both the view and the raw report", async () => {
    const res = await upload([
      { name: "transactions.csv", content: TRANSACTIONS },
      { name: "holdings.csv", content: HOLDINGS },
    ]);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(typeof body.reportId).toBe("string");
    // The contract payload is present and unmodified (DATA_MODEL.md §1).
    expect(body.report.model.currency).toBe("USD");
    expect(body.report.model.transactions).toHaveLength(8);
    expect(body.report.analyses.map((a: { module: string }) => a.module)).toContain("cashflow");
    // The view is derived from it.
    expect(body.view.meta.transactions).toBe(8);
    expect(body.view.cashflow.months).toHaveLength(3);
    expect(body.view.portfolio.holdings).toHaveLength(2);
  });

  it("simulates a scenario against a previously analysed report", async () => {
    const analysed = await (await upload([{ name: "transactions.csv", content: TRANSACTIONS }])).json();
    const res = await fetch(`${base}/api/scenario`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reportId: analysed.reportId, incomePct: -0.2 }),
    });

    expect(res.status).toBe(200);
    const view = await res.json();
    expect(view.description).toContain("income");
    expect(view.rows.length).toBeGreaterThan(0);
    const net = view.rows.find((r: { label: string }) => r.label === "Net cash flow");
    expect(net.tone).toBe("critical");
  });

  it("refuses a scenario for a report it no longer holds", async () => {
    const res = await fetch(`${base}/api/scenario`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reportId: "nope", incomePct: 0.1 }),
    });
    expect(res.status).toBe(410);
    expect((await res.json()).kind).toBe("ReportExpired");
  });

  it("surfaces a mixed-currency dataset as a clean CurrencyMismatchError", async () => {
    const mixed = [
      "Date,Description,Amount,Currency",
      "2024-01-01,Salary,5000,USD",
      "2024-01-08,Rent,-1800,INR",
    ].join("\n");
    const res = await upload([{ name: "mixed.csv", content: mixed }]);

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.kind).toBe("CurrencyMismatchError");
    expect(body.error).toMatch(/currenc/i);
    expect(body.error).not.toContain("at Object."); // no stack trace
  });

  it("surfaces an unsupported file type as a clean IngestionError", async () => {
    const res = await upload([{ name: "notes.txt", content: "hello" }]);
    expect(res.status).toBe(422);
    expect((await res.json()).kind).toBe("IngestionError");
  });

  it("rejects a request with no files", async () => {
    const res = await upload([]);
    expect(res.status).toBe(400);
  });
});
