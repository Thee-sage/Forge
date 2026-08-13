import { describe, it, expect } from "vitest";
import {
  CurrencyMismatchError,
  assertSingleCurrency,
  distinctCurrencies,
  normalizeCurrencyCode,
} from "./currency.js";
import { runAnalyses, assertSingleCurrencyModel } from "../analysis/index.js";
import { makeHolding, makeModel, makeTxn } from "../testkit.js";

describe("normalizeCurrencyCode", () => {
  it("maps symbols and words to ISO codes", () => {
    expect(normalizeCurrencyCode("$")).toBe("USD");
    expect(normalizeCurrencyCode("₹")).toBe("INR");
    expect(normalizeCurrencyCode("Rs")).toBe("INR");
    expect(normalizeCurrencyCode("usd")).toBe("USD");
    expect(normalizeCurrencyCode("Euro")).toBe("EUR");
    expect(normalizeCurrencyCode("gbp")).toBe("GBP");
  });
  it("upper-cases bare 3-letter codes", () => {
    expect(normalizeCurrencyCode("inr")).toBe("INR");
    expect(normalizeCurrencyCode("jpy")).toBe("JPY");
  });
  it("returns undefined for empty/unknown so a default can apply", () => {
    expect(normalizeCurrencyCode("")).toBeUndefined();
    expect(normalizeCurrencyCode(null)).toBeUndefined();
    expect(normalizeCurrencyCode("   ")).toBeUndefined();
  });
});

describe("currency aggregation guards", () => {
  it("distinctCurrencies lists codes in first-seen order", () => {
    expect(distinctCurrencies([{ currency: "USD" }, { currency: "INR" }, { currency: "USD" }])).toEqual(["USD", "INR"]);
  });

  it("assertSingleCurrency returns the single code or throws on mixing", () => {
    expect(assertSingleCurrency([{ currency: "INR" }, { currency: "INR" }], "sum")).toBe("INR");
    expect(assertSingleCurrency([], "sum")).toBeUndefined();
    expect(() => assertSingleCurrency([{ currency: "USD" }, { currency: "INR" }], "sum")).toThrow(CurrencyMismatchError);
  });
});

describe("single-currency model integrity", () => {
  it("INR-only and USD-only models analyse fine", () => {
    const inr = makeModel([makeTxn("2024-01-01", 1000, "salary", { currency: "INR" })]);
    const usd = makeModel([makeTxn("2024-01-01", 1000, "salary", { currency: "USD" })]);
    expect(() => runAnalyses(inr)).not.toThrow();
    expect(() => runAnalyses(usd)).not.toThrow();
  });

  it("multiple sources sharing one currency analyse fine", () => {
    const m = makeModel(
      [makeTxn("2024-01-01", 1000, "salary", { currency: "USD" })],
      [makeHolding("VOO", 5000, "equity", "USD")],
    );
    expect(() => runAnalyses(m)).not.toThrow();
  });

  it("FAILS CLEARLY when transactions and holdings use different currencies", () => {
    const m = makeModel(
      [makeTxn("2024-01-01", 1000, "salary", { currency: "INR" })],
      [makeHolding("VOO", 5000, "equity", "USD")],
    );
    expect(() => runAnalyses(m)).toThrow(CurrencyMismatchError);
    expect(() => assertSingleCurrencyModel(m)).toThrow(/multiple currencies/i);
  });

  it("FAILS CLEARLY when transactions themselves mix currencies (conflicting metadata)", () => {
    const m = makeModel([
      makeTxn("2024-01-01", 1000, "salary", { currency: "USD" }),
      makeTxn("2024-01-05", -200, "food", { currency: "INR" }),
    ]);
    expect(() => runAnalyses(m)).toThrow(CurrencyMismatchError);
  });

  it("never silently sums across currencies — the error names the offending codes", () => {
    const m = makeModel([
      makeTxn("2024-01-01", 1000, "a", { currency: "USD" }),
      makeTxn("2024-01-02", 1000, "b", { currency: "EUR" }),
    ]);
    try {
      runAnalyses(m);
      throw new Error("expected a CurrencyMismatchError");
    } catch (err) {
      expect(err).toBeInstanceOf(CurrencyMismatchError);
      expect((err as CurrencyMismatchError).currencies.sort()).toEqual(["EUR", "USD"]);
    }
  });
});
