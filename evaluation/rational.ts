/**
 * Exact rational arithmetic on BigInt. The oracle uses this instead of IEEE doubles so that
 * every reference value is exact (no accumulated rounding), which makes it a numerically
 * independent implementation of Forge's float-based calculations.
 */
const gcd = (a: bigint, b: bigint): bigint => {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b !== 0n) [a, b] = [b, a % b];
  return a;
};

export class Rat {
  readonly n: bigint;
  readonly d: bigint;
  constructor(n: bigint, d: bigint = 1n) {
    if (d === 0n) throw new Error("Rat: zero denominator");
    if (d < 0n) {
      n = -n;
      d = -d;
    }
    const g = gcd(n, d) || 1n;
    this.n = n / g;
    this.d = d / g;
  }
  static int(n: number | bigint): Rat {
    return new Rat(BigInt(n));
  }
  /** Parse an exact decimal string such as "-1234.50", "0.2", "1e3" is NOT accepted. */
  static dec(s: string): Rat {
    const m = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(s.trim());
    if (!m) throw new Error(`Rat.dec: not a plain decimal: ${JSON.stringify(s)}`);
    const frac = m[3] ?? "";
    const n = BigInt(m[2]! + frac);
    return new Rat(m[1] === "-" ? -n : n, 10n ** BigInt(frac.length));
  }
  add(o: Rat): Rat { return new Rat(this.n * o.d + o.n * this.d, this.d * o.d); }
  sub(o: Rat): Rat { return new Rat(this.n * o.d - o.n * this.d, this.d * o.d); }
  mul(o: Rat): Rat { return new Rat(this.n * o.n, this.d * o.d); }
  div(o: Rat): Rat { return new Rat(this.n * o.d, this.d * o.n); }
  neg(): Rat { return new Rat(-this.n, this.d); }
  abs(): Rat { return this.n < 0n ? this.neg() : this; }
  cmp(o: Rat): number {
    const l = this.n * o.d;
    const r = o.n * this.d;
    return l < r ? -1 : l > r ? 1 : 0;
  }
  lt(o: Rat): boolean { return this.cmp(o) < 0; }
  gt(o: Rat): boolean { return this.cmp(o) > 0; }
  le(o: Rat): boolean { return this.cmp(o) <= 0; }
  ge(o: Rat): boolean { return this.cmp(o) >= 0; }
  eq(o: Rat): boolean { return this.cmp(o) === 0; }
  isZero(): boolean { return this.n === 0n; }
  /** floor(x) as bigint. */
  floor(): bigint {
    const q = this.n / this.d;
    return this.n % this.d !== 0n && this.n < 0n ? q - 1n : q;
  }
  /** Round half up (matches Math.round for the values Forge produces). */
  roundHalfUp(): bigint {
    return this.add(new Rat(1n, 2n)).floor();
  }
  toNumber(): number {
    const scale = 10n ** 40n;
    return Number((this.n * scale) / this.d) / 1e40;
  }
}

export const ZERO = Rat.int(0);
export const ONE = Rat.int(1);

export const sumRat = (xs: Rat[]): Rat => xs.reduce((a, b) => a.add(b), ZERO);
export const minRat = (a: Rat, b: Rat): Rat => (a.le(b) ? a : b);
export const maxRat = (a: Rat, b: Rat): Rat => (a.ge(b) ? a : b);
export const clampRat = (x: Rat, lo: Rat, hi: Rat): Rat => maxRat(lo, minRat(hi, x));

/** Median of a non-empty list (mean of the two middle values for even length). */
export function medianRat(xs: Rat[]): Rat {
  const s = [...xs].sort((a, b) => a.cmp(b));
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : s[mid - 1]!.add(s[mid]!).div(Rat.int(2));
}
