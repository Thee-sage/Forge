import type { RawRecord } from "../core/model.js";

/** The kind of data a table appears to contain. */
export type TableShape = "transactions" | "holdings" | "unknown";

/** A single parsed table (one sheet, or one CSV file). */
export interface RawTable {
  /** Sheet name or file basename. */
  name: string;
  /** The source file path this table came from. */
  source: string;
  /** Normalized header keys (trimmed, original casing preserved). */
  headers: string[];
  /** Data rows keyed by header. */
  rows: RawRecord[];
  /** Best-guess shape after detection. */
  shape: TableShape;
}

/** Supported input file extensions. */
export const SUPPORTED_EXTENSIONS = [".csv", ".xlsx", ".xls", ".tsv"] as const;
