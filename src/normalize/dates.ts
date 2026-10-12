/**
 * Date normalization. Sources use many date formats; we coerce them all to ISO
 * `YYYY-MM-DD`. Returns undefined when a value can't be understood as a date, so the
 * caller can record a warning rather than guess (PROJECT_RULES §5).
 *
 * For numeric day/month/year strings the field order (DD/MM vs MM/DD) is genuinely
 * ambiguous per-value; callers should first infer the order for a whole column with
 * `inferDateOrder` and pass it in, so the assumption is made once and reported.
 */

export type DateOrder = "dmy" | "mdy";

/** Convert a raw cell (Date, Excel serial number, or string) to ISO YYYY-MM-DD. */
export function toIsoDate(raw: unknown, order: DateOrder = "dmy"): string | undefined {
  if (raw === null || raw === undefined || raw === "") return undefined;

  if (raw instanceof Date) return isoFromDate(raw);

  if (typeof raw === "number") {
    // Excel serial date (days since 1899-12-30). Only treat plausible ranges as dates.
    if (raw > 59 && raw < 60000) {
      const ms = (raw - 25569) * 86400 * 1000;
      const d = new Date(ms);
      if (!Number.isNaN(d.getTime())) return isoFromDate(d);
    }
    return undefined;
  }

  if (typeof raw === "string") return parseStringDate(raw.trim(), order);
  return undefined;
}

/** The result of inspecting a whole date column to decide DD/MM vs MM/DD. */
export interface DateOrderInference {
  order: DateOrder;
  /** True when no value in the column disambiguates the order (we assumed a default). */
  ambiguous: boolean;
  /** True when some values imply DD/MM and others imply MM/DD (contradiction). */
  conflict: boolean;
}

/**
 * Infer the field order for a column of numeric slash/dash dates. A value like `13/02`
 * proves DD/MM (13 can't be a month); `02/13` proves MM/DD. If both appear it's a
 * conflict; if neither appears it's ambiguous. Defaults to DD/MM (most non-US exports).
 */
export function inferDateOrder(values: unknown[]): DateOrderInference {
  let dmySignals = 0;
  let mdySignals = 0;
  for (const v of values) {
    if (typeof v !== "string") continue;
    const m = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/.exec(v.trim());
    if (!m) continue;
    const first = Number(m[1]);
    const second = Number(m[2]);
    if (first > 12 && second <= 12) dmySignals += 1;
    else if (second > 12 && first <= 12) mdySignals += 1;
  }
  const conflict = dmySignals > 0 && mdySignals > 0;
  if (conflict) return { order: "dmy", ambiguous: false, conflict: true };
  if (mdySignals > 0) return { order: "mdy", ambiguous: false, conflict: false };
  if (dmySignals > 0) return { order: "dmy", ambiguous: false, conflict: false };
  return { order: "dmy", ambiguous: true, conflict: false };
}

function isoFromDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function isLeap(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

/** True when y-m-d is a real calendar date (month 1-12, day within the month, leap years included). */
export function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const days = month === 2 && isLeap(year) ? 29 : DAYS_IN_MONTH[month - 1]!;
  return day <= days;
}

/** Return the ISO string for y-m-d, or undefined when it is not a real calendar date. */
function iso(year: number, month: number, day: number): string | undefined {
  return isValidCalendarDate(year, month, day) ? `${year}-${pad(month)}-${pad(day)}` : undefined;
}

function parseStringDate(s: string, order: DateOrder): string | undefined {
  if (s === "") return undefined;

  // ISO (optionally followed by a time): YYYY-MM-DD. Validated, not merely pattern-matched.
  const isoM = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/.exec(s);
  if (isoM) return iso(Number(isoM[1]), Number(isoM[2]), Number(isoM[3]));

  // YYYY/MM/DD and YYYY.MM.DD.
  const ymd = /^(\d{4})[/.](\d{1,2})[/.](\d{1,2})$/.exec(s);
  if (ymd) return iso(Number(ymd[1]), Number(ymd[2]), Number(ymd[3]));

  // DD/MM/YYYY or MM/DD/YYYY or with '-' / '.' separators.
  const dmy = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/.exec(s);
  if (dmy) {
    const [, a, b, y] = dmy as unknown as [string, string, string, string];
    let year = Number(y);
    if (year < 100) year += year < 70 ? 2000 : 1900;
    const first = Number(a);
    const second = Number(b);
    // A field > 12 can only be the day, regardless of the assumed order.
    let month: number;
    let day: number;
    if (first > 12) {
      day = first;
      month = second;
    } else if (second > 12) {
      month = first;
      day = second;
    } else if (order === "mdy") {
      // Both plausible — use the order inferred for the whole column.
      month = first;
      day = second;
    } else {
      day = first;
      month = second;
    }
    return iso(year, month, day);
  }

  // Month-name formats: "Jan 5, 2024", "January 5th 2024", "5 Jan 2024", "Mon, 5 Jan 2024".
  // Parsed explicitly (never via Date.parse, whose legacy parser turns text such as "hello 5"
  // into a date) so the result is deterministic and time-zone independent.
  const name = "([A-Za-z]{3,9})\\.?";
  const ord = "(?:st|nd|rd|th)?";
  const weekday = "(?:[A-Za-z]{3,9},?\\s+)?";
  const mdyName = new RegExp(`^${weekday}${name}\\s+(\\d{1,2})${ord},?\\s+(\\d{4})$`).exec(s);
  const dmyName = new RegExp(`^${weekday}(\\d{1,2})${ord}\\s+${name},?\\s+(\\d{4})$`).exec(s);
  const parts = mdyName
    ? { mon: mdyName[1]!, day: mdyName[2]!, year: mdyName[3]! }
    : dmyName
      ? { mon: dmyName[2]!, day: dmyName[1]!, year: dmyName[3]! }
      : undefined;
  if (parts) {
    const idx = MONTHS.indexOf(parts.mon.slice(0, 3).toLowerCase());
    // Require the full name or a standard abbreviation, so "Janet 5, 2024" is not a date.
    if (idx >= 0 && /^[A-Za-z]+$/.test(parts.mon) && FULL_OR_ABBR.has(parts.mon.toLowerCase())) {
      return iso(Number(parts.year), idx + 1, Number(parts.day));
    }
  }
  return undefined;
}

const FULL_OR_ABBR = new Set([
  "jan", "january", "feb", "february", "mar", "march", "apr", "april", "may", "jun", "june",
  "jul", "july", "aug", "august", "sep", "sept", "september", "oct", "october", "nov", "november",
  "dec", "december",
]);

function pad(n: number): string {
  return String(n).padStart(2, "0");
}
