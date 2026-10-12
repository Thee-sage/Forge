/** Statistical helpers for reporting uncertainty. */

export interface Interval {
  point: number;
  lower: number;
  upper: number;
  method: string;
}

/**
 * Wilson score interval for a binomial proportion (95% by default). Chosen over the normal
 * approximation because it stays inside [0,1] and behaves for small n and for k = 0 or k = n.
 * It assumes the n trials are independent; where trials are correlated (several metrics from
 * one case) the interval is optimistic, which the report states.
 */
export function wilson(k: number, n: number, z = 1.959964): Interval {
  const method = "Wilson score interval, 95%";
  if (n === 0) return { point: NaN, lower: NaN, upper: NaN, method };
  const p = k / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return { point: p, lower: Math.max(0, centre - half), upper: Math.min(1, centre + half), method };
}

/** Deterministic PRNG (mulberry32) so bootstrap intervals are reproducible. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Counts { tp: number; fp: number; fn: number; tn: number }

export function prf(c: Counts): { precision: number; recall: number; f1: number } {
  const precision = c.tp + c.fp === 0 ? NaN : c.tp / (c.tp + c.fp);
  const recall = c.tp + c.fn === 0 ? NaN : c.tp / (c.tp + c.fn);
  const f1 =
    Number.isNaN(precision) || Number.isNaN(recall) || precision + recall === 0
      ? NaN
      : (2 * precision * recall) / (precision + recall);
  return { precision, recall, f1 };
}

/** Percentile bootstrap CI for F1 over labelled items ("tp" | "fp" | "fn" | "tn"). */
export function bootstrapF1(
  items: ("tp" | "fp" | "fn" | "tn")[],
  seed = 20261004,
  iterations = 2000,
): Interval {
  const method = `Percentile bootstrap, ${iterations} resamples, seed ${seed}, 95%`;
  if (items.length === 0) return { point: NaN, lower: NaN, upper: NaN, method };
  const rand = mulberry32(seed);
  const tally = (xs: typeof items): number => {
    const c: Counts = { tp: 0, fp: 0, fn: 0, tn: 0 };
    for (const x of xs) c[x] += 1;
    return prf(c).f1;
  };
  const point = tally(items);
  const draws: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const sample = Array.from({ length: items.length }, () => items[Math.floor(rand() * items.length)]!);
    const f = tally(sample);
    if (!Number.isNaN(f)) draws.push(f);
  }
  draws.sort((a, b) => a - b);
  if (draws.length === 0) return { point, lower: NaN, upper: NaN, method };
  return {
    point,
    lower: draws[Math.floor(0.025 * (draws.length - 1))]!,
    upper: draws[Math.ceil(0.975 * (draws.length - 1))]!,
    method,
  };
}
