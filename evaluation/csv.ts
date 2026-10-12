import type { AmountFormat, DateFormat, InputSpec, Truth } from "./types.js";
import { Rat } from "./rational.js";

/** Renders ground truth into the CSV text Forge ingests. Independent of Forge's parsers. */

const q = (s: string): string => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

function groupThousands(intPart: string): string {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** Format |amount| as "1,234.50" (always two decimals; truth amounts have <= 2 dp unless stated). */
function plain(abs: Rat, grouped: boolean): string {
  const cents = abs.mul(Rat.int(100)).roundHalfUp();
  const s = cents.toString().padStart(3, "0");
  const intPart = s.slice(0, -2);
  const frac = s.slice(-2);
  return `${grouped ? groupThousands(intPart) : intPart}.${frac}`;
}

function renderDate(iso: string, fmt: DateFormat): string {
  const [y, m, d] = iso.split("-") as [string, string, string];
  switch (fmt) {
    case "iso": return iso;
    case "dmy": return `${d}/${m}/${y}`;
    case "mdy": return `${m}/${d}/${y}`;
    case "long": {
      const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      return `${names[Number(m) - 1]} ${Number(d)}, ${y}`;
    }
  }
}

function amountCells(signed: string, fmt: AmountFormat, currency: string): { amount?: string; debit?: string; credit?: string } {
  const r = Rat.dec(signed);
  const neg = r.n < 0n;
  const abs = r.abs();
  switch (fmt) {
    case "signed": return { amount: `${neg ? "-" : ""}${plain(abs, false)}` };
    case "parens": return { amount: neg ? `(${plain(abs, true)})` : plain(abs, true) };
    case "symbol": {
      const sym = ({ USD: "$", EUR: "€", GBP: "£", INR: "₹" } as Record<string, string>)[currency] ?? "$";
      return { amount: `${neg ? "-" : ""}${sym}${plain(abs, true)}` };
    }
    case "debitcredit": return neg ? { debit: plain(abs, false) } : { credit: plain(abs, false) };
  }
}

export function renderTransactionsCsv(truth: Truth, input: InputSpec = {}): string {
  if (input.rawTransactionsCsv !== undefined) return input.rawTransactionsCsv;
  const af = input.amountFormat ?? "signed";
  const df = input.dateFormat ?? "iso";
  const header: string[] = ["Date", "Description"];
  if (af === "debitcredit") header.push("Debit", "Credit");
  else header.push("Amount");
  if (!input.omitCategory) header.push("Category");
  if (input.currencyColumn) header.push("Currency");
  const lines = [header.join(",")];
  truth.txns.forEach((t, i) => {
    const a = amountCells(t.amount, af, truth.currency);
    const row: string[] = [q(renderDate(t.date, df)), q(t.description)];
    if (af === "debitcredit") row.push(q(a.debit ?? ""), q(a.credit ?? ""));
    else row.push(q(a.amount ?? ""));
    if (!input.omitCategory) row.push(q(input.categoryText?.[i] ?? t.category));
    if (input.currencyColumn) row.push(q(input.currencyColumn[i] ?? ""));
    lines.push(row.join(","));
  });
  return lines.join("\n") + "\n";
}

/** Readable asset-class text, as a person would type it (never the snake_case enum). */
const CLASS_TEXT: Record<string, string> = {
  equity: "Equity", fixed_income: "Fixed Income", cash: "Cash", real_estate: "Real Estate",
  commodity: "Commodity", crypto: "Crypto", alternative: "Alternative", unknown: "Other",
};

export function renderHoldingsCsv(truth: Truth, input: InputSpec = {}): string {
  if (input.rawHoldingsCsv !== undefined) return input.rawHoldingsCsv;
  const lines = ["Symbol,Name,Asset Class,Quantity,Price,Value"];
  truth.holdings.forEach((h, i) => {
    const text = input.holdingClassText?.[i] ?? CLASS_TEXT[h.assetClass] ?? h.assetClass;
    lines.push([q(h.symbol), q(h.symbol), q(text), "1", plain(Rat.dec(h.value), false), plain(Rat.dec(h.value), false)].join(","));
  });
  return lines.join("\n") + "\n";
}
