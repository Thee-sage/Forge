import { basename, extname } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import XLSX from "xlsx";
import type { RawRecord } from "../core/model.js";
import { ForgeError } from "../core/errors.js";
import { detectShape, headersFromRows } from "./detect.js";
import { SUPPORTED_EXTENSIONS, type RawTable } from "./types.js";

export type { RawTable, TableShape } from "./types.js";
export { detectShape } from "./detect.js";

/** Thrown when a file cannot be ingested. */
export class IngestionError extends ForgeError {}

/**
 * Load a financial file into one or more RawTables (one per sheet).
 * Supports CSV/TSV and Excel via SheetJS. Dates are parsed to JS Date objects.
 */
export function ingest(path: string): RawTable[] {
  if (!existsSync(path)) {
    throw new IngestionError(`File not found: ${path}`);
  }
  const ext = extname(path).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.includes(ext as (typeof SUPPORTED_EXTENSIONS)[number])) {
    throw new IngestionError(
      `Unsupported file type "${ext}". Supported: ${SUPPORTED_EXTENSIONS.join(", ")}`,
    );
  }

  let workbook: XLSX.WorkBook;
  try {
    if (ext === ".csv" || ext === ".tsv") {
      // Delimited text is UTF-8. Letting SheetJS read the bytes itself decodes them as Latin-1,
      // which turns "€" into "â¬" and silently corrupts currency symbols, merchant names and
      // categories. Decode explicitly (dropping a BOM) and hand SheetJS the string.
      const text = readFileSync(path, "utf8").replace(/^\uFEFF/, "");
      workbook = XLSX.read(text, { type: "string", cellDates: true, raw: true, ...(ext === ".tsv" ? { FS: "\t" } : {}) });
    } else {
      workbook = XLSX.readFile(path, { cellDates: true, raw: true });
    }
  } catch (err) {
    throw new IngestionError(
      `Failed to read ${path}: ${(err as Error).message}`,
    );
  }

  const tables: RawTable[] = [];
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const rows = XLSX.utils.sheet_to_json<RawRecord>(sheet, {
      defval: null,
      raw: true,
    });
    if (rows.length === 0) continue;

    const headers = headersFromRows(rows);
    tables.push({
      name: workbook.SheetNames.length > 1 ? sheetName : basename(path),
      source: path,
      headers,
      rows,
      shape: detectShape(headers),
    });
  }

  if (tables.length === 0) {
    throw new IngestionError(`No data rows found in ${path}`);
  }
  return tables;
}
