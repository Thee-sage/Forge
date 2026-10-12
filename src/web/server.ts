/**
 * Forge web server.
 *
 * A thin transport in front of the engine. It owns no analysis: every figure it returns
 * comes from `analyzeFile` / `simulate` and is shaped for display by the pure
 * `buildReportView` adapter. Built on `node:http` only — the web interface adds no
 * runtime dependency to the project.
 *
 * Routes
 *   GET  /                     the single-page client
 *   GET  /styles.css, /app.js  static client assets
 *   POST /api/analyze          { files: [{ name, base64 }] } -> AnalyzeResponse
 *   POST /api/samples          analyse the bundled sample dataset -> AnalyzeResponse
 *   POST /api/scenario         { reportId, incomePct, expensePct } -> ScenarioView
 *
 * Reports are held in a bounded in-memory cache for the life of the process so a
 * scenario can be re-simulated without re-uploading. There is no database and nothing is
 * written outside the OS temp directory (PROJECT_SCOPE §3).
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, extname, basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { analyzeFile, type ForgeReport } from "../index.js";
import { ForgeError } from "../core/errors.js";
import { simulate, type ScenarioSpec } from "../scenario/simulate.js";
import { buildReportView, buildScenarioView, type ReportView, type ScenarioView } from "./viewmodel.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(HERE, "..", "..");
/**
 * Client assets live next to this file in source. `tsc` compiles TypeScript only, so a
 * built `dist/web/` has no `public/` beside it — fall back to the source copy, which is
 * the same directory the dev run uses.
 */
const PUBLIC_DIR = existsSync(join(HERE, "public"))
  ? join(HERE, "public")
  : join(PROJECT_ROOT, "src", "web", "public");

/** Uploads are held in memory before being written to a temp file; keep them sane. */
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
/** How many reports stay simulatable at once (oldest evicted first). */
const MAX_CACHED_REPORTS = 20;

export interface AnalyzeResponse {
  reportId: string;
  view: ReportView;
  /** The raw contract payload, so the client can be inspected against DATA_MODEL.md. */
  report: ForgeReport;
}

interface CachedReport {
  report: ForgeReport;
}

const cache = new Map<string, CachedReport>();

function cacheReport(report: ForgeReport): string {
  const id = randomUUID();
  cache.set(id, { report });
  while (cache.size > MAX_CACHED_REPORTS) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
  return id;
}

/** Create the Forge web server. Call `.listen(port)` on the result. */
export function createForgeServer() {
  return createServer((req, res) => {
    handle(req, res).catch((err: unknown) => {
      sendError(res, err);
    });
  });
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const path = url.pathname;

  if (req.method === "GET" && (path === "/" || path === "/index.html")) {
    return sendStatic(res, "index.html");
  }
  if (req.method === "GET" && (path === "/styles.css" || path === "/app.js")) {
    return sendStatic(res, path.slice(1));
  }
  if (req.method === "POST" && path === "/api/analyze") {
    return void (await analyzeUpload(req, res));
  }
  if (req.method === "POST" && path === "/api/samples") {
    return void (await analyzeSamples(res));
  }
  if (req.method === "POST" && path === "/api/scenario") {
    return void (await runScenario(req, res));
  }
  sendJson(res, 404, { error: "Not found", kind: "NotFound" });
}

/* ------------------------------------------------------------------ routes */

interface UploadPayload {
  files?: { name?: string; base64?: string }[];
}

async function analyzeUpload(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readJson<UploadPayload>(req);
  const files = (body.files ?? []).filter((f): f is { name: string; base64: string } =>
    typeof f?.name === "string" && typeof f?.base64 === "string",
  );
  if (files.length === 0) {
    return sendJson(res, 400, { error: "No files were uploaded.", kind: "BadRequest" });
  }

  // Files arrive as bytes, but ingestion reads paths — stage them in a temp directory
  // and remove it as soon as the model is built. The report keeps only the model.
  const dir = await mkdtemp(join(tmpdir(), "forge-upload-"));
  try {
    const paths: string[] = [];
    for (const f of files) {
      const safe = basename(f.name).replace(/[^A-Za-z0-9._-]/g, "_");
      const target = join(dir, safe);
      await writeFile(target, Buffer.from(f.base64, "base64"));
      paths.push(target);
    }
    respondWithReport(res, analyzeFile(paths));
  } catch (err) {
    sendError(res, err);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const SAMPLE_FILES = ["personal_transactions.csv", "portfolio_holdings.csv"];

async function analyzeSamples(res: ServerResponse): Promise<void> {
  const paths = SAMPLE_FILES.map((f) => join(PROJECT_ROOT, "samples", f)).filter((p) => existsSync(p));
  if (paths.length === 0) {
    return sendJson(res, 404, {
      error: "The bundled sample dataset is not present in this installation.",
      kind: "NotFound",
    });
  }
  try {
    respondWithReport(res, analyzeFile(paths));
  } catch (err) {
    sendError(res, err);
  }
}

function respondWithReport(res: ServerResponse, report: ForgeReport): void {
  const reportId = cacheReport(report);
  const payload: AnalyzeResponse = { reportId, view: buildReportView(report), report };
  sendJson(res, 200, payload);
}

interface ScenarioPayload {
  reportId?: string;
  incomePct?: number;
  expensePct?: number;
}

async function runScenario(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readJson<ScenarioPayload>(req);
  const cached = body.reportId ? cache.get(body.reportId) : undefined;
  if (!cached) {
    return sendJson(res, 410, {
      error: "That report is no longer held in memory. Re-run the analysis to simulate against it.",
      kind: "ReportExpired",
    });
  }

  const spec: ScenarioSpec = {};
  if (Number.isFinite(body.incomePct) && body.incomePct !== 0) spec.incomePct = body.incomePct;
  if (Number.isFinite(body.expensePct) && body.expensePct !== 0) spec.expensePct = body.expensePct;

  try {
    const result = simulate(cached.report.model, spec, cached.report.analyses);
    const view: ScenarioView = buildScenarioView(result, cached.report.model.currency);
    sendJson(res, 200, view);
  } catch (err) {
    sendError(res, err);
  }
}

/* ------------------------------------------------------------------ plumbing */

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
};

async function sendStatic(res: ServerResponse, name: string): Promise<void> {
  const file = join(PUBLIC_DIR, basename(name));
  try {
    const body = await readFile(file);
    res.writeHead(200, {
      "Content-Type": MIME[extname(file)] ?? "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    res.end(body);
  } catch {
    sendJson(res, 404, { error: `Asset not found: ${name}`, kind: "NotFound" });
  }
}

async function readJson<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > MAX_UPLOAD_BYTES) {
      throw new ForgeError(`Upload exceeds the ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB limit.`);
    }
    chunks.push(buf);
  }
  if (chunks.length === 0) return {} as T;
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
  } catch {
    throw new ForgeError("Request body was not valid JSON.");
  }
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

/**
 * Expected failures extend `ForgeError` and are rendered as a clean message with the
 * error's class name so the client can present it the way the CLI does — never a stack
 * trace (PROJECT_RULES §10, "fail clean"). Anything else is an internal bug.
 */
function sendError(res: ServerResponse, err: unknown): void {
  if (res.headersSent) return;
  if (err instanceof ForgeError) {
    return sendJson(res, 422, { error: err.message, kind: err.name });
  }
  const message = err instanceof Error ? err.message : String(err);
  sendJson(res, 500, { error: `Internal error: ${message}`, kind: "InternalError" });
}

/** Start the server and resolve once it is listening. */
export function startForgeServer(port: number, host = "127.0.0.1"): Promise<{ port: number; close: () => Promise<void> }> {
  const server = createForgeServer();
  return new Promise((resolvePromise, rejectPromise) => {
    server.once("error", rejectPromise);
    server.listen(port, host, () => {
      const address = server.address();
      const actual = typeof address === "object" && address ? address.port : port;
      resolvePromise({
        port: actual,
        close: () => new Promise<void>((done) => server.close(() => done())),
      });
    });
  });
}
