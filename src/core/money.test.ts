import { describe, it, expect } from "vitest";
import { parseAmount, round, formatMoney, formatPercent, median, stddev } from "./money.js";

describe("parseAmount", () => {
  it("parses plain numbers and numeric strings", () => {
    expect(parseAmount(1234.5)).toBe(1234.5);
    expect(parseAmount("1234.50")).toBe(1234.5);
  });
  it("strips currency symbols and thousands separators", () => {
    expect(parseAmount("$1,234.50")).toBe(1234.5);
    expect(parseAmount("£2,000")).toBe(2000);
  });
  it("treats parenthesised values as negative (accounting)", () => {
    expect(parseAmount("(1,200.00)")).toBe(-1200);
  });
  it("returns undefined for empty/garbage", () => {
    expect(parseAmount("")).toBeUndefined();
    expect(parseAmount("n/a")).toBeUndefined();
    expect(parseAmount(null)).toBeUndefined();
  });
});

describe("formatting", () => {
  it("rounds for display only", () => {
    expect(round(1.005, 2)).toBe(1.01);
  });
  it("formats money and percent", () => {
    expect(formatMoney(1234.5, "USD")).toBe("$1,234.50");
    expect(formatPercent(0.1234)).toBe("12.3%");
  });
});

describe("statistics", () => {
  it("computes median and stddev", () => {
    expect(median([1, 3, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(stddev([2, 2, 2])).toBe(0);
    expect(stddev([1])).toBe(0);
  });
});
