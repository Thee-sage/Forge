/** A row that could not be normalized, kept so every drop is individually explainable. */
export interface SkippedRow {
  table: string;
  source: string;
  /** 0-based row index within the table's data rows. */
  row: number;
  reason: string;
}
