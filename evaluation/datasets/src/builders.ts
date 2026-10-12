import type { AssetClassLabel, PipelineCase, Split, Truth, TruthHolding, TruthTxn } from "../../types.js";

/**
 * Compact DSL for authoring cases.
 *   txns:     "2024-01-05 +5200 salary Salary ACME"   (date, signed amount, category, description...)
 *   holdings: "AAPL 20000 equity"                     (symbol, value, class)
 */
export function T(...lines: string[]): TruthTxn[] {
  return lines.map((line) => {
    const [date, amt, category, ...rest] = line.trim().split(/\s+/);
    if (!date || !amt || !category) throw new Error(`bad txn line: ${line}`);
    return {
      date,
      amount: amt.startsWith("+") ? amt.slice(1) : amt,
      category,
      description: rest.join(" ") || category,
    };
  });
}

export function H(...lines: string[]): TruthHolding[] {
  return lines.map((line) => {
    const [symbol, value, cls] = line.trim().split(/\s+/);
    if (!symbol || !value || !cls) throw new Error(`bad holding line: ${line}`);
    return { symbol, value, assetClass: cls as AssetClassLabel };
  });
}

export function truth(txns: TruthTxn[], holdings: TruthHolding[] = [], currency = "USD"): Truth {
  return { currency, txns, holdings };
}

/** Repeat a monthly pattern over consecutive months starting at `startYm` ("2024-01"). */
export function monthly(startYm: string, count: number, build: (ym: string, i: number) => string[]): TruthTxn[] {
  const [y0, m0] = startYm.split("-").map(Number) as [number, number];
  const out: TruthTxn[] = [];
  for (let i = 0; i < count; i++) {
    const idx = m0 - 1 + i;
    const y = y0 + Math.floor(idx / 12);
    const m = (idx % 12) + 1;
    const ym = `${y}-${String(m).padStart(2, "0")}`;
    out.push(...T(...build(ym, i)));
  }
  return out;
}

export interface CaseInit extends Omit<PipelineCase, "split" | "tags"> { tags?: string[] }

export function mk(split: Split): (c: CaseInit) => PipelineCase {
  return (c) => ({ ...c, split, tags: c.tags ?? [] });
}

/** A 6-month household used as the base for scenario and health cases. */
export function household(variant: "a" | "b" = "a"): { txns: TruthTxn[]; holdings: TruthHolding[] } {
  const salary = variant === "a" ? "6000" : "4500";
  const txns = monthly("2024-01", 6, (ym, i) => [
    `${ym}-01 +${salary} salary Salary`,
    `${ym}-03 -${variant === "a" ? 1800 : 1400} housing Rent`,
    `${ym}-08 -${420 + i * 15}.50 groceries Groceries`,
    `${ym}-14 -${95 + i * 7} dining Dining out`,
    `${ym}-20 -${60 + (i % 3) * 11}.25 transport Transport`,
    `${ym}-25 -${130 + i * 3} utilities Utilities`,
  ]);
  const holdings = H(
    variant === "a" ? "CASHACC 9000 cash" : "CASHACC 2500 cash",
    "VTI 30000 equity",
    "BNDX 12000 fixed_income",
    variant === "a" ? "GLD 4000 commodity" : "BTC 3000 crypto",
  );
  return { txns, holdings };
}
