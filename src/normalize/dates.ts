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

function parseStringDate(s: string, order: DateOrder): string | undefined {
  if (s === "") return undefined;

  // Already ISO (optionally with time).
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

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
    } else {
      // Both plausible — use the order inferred for the whole column.
      if (order === "mdy") {
        month = first;
        day = second;
      } else {
        day = first;
        month = second;
      }
    }
    if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
    return `${year}-${pad(month)}-${pad(day)}`;
  }

  // Fallback to Date.parse for month-name formats ("Jan 5, 2024"). A date-only string
  // means a calendar date in the user's locale, so read local components — reading UTC
  // would shift the day in positive-offset time zones.
  const parsed = new Date(s);
  if (!Number.isNaN(parsed.getTime())) return isoFromLocalDate(parsed);
  return undefined;
}

function isoFromLocalDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}
