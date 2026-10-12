import { describe, it, expect } from "vitest";
import { parseAmount } from "./money.js";
import { currencyInAmountText, normalizeCurrencyCode } from "./currency.js";

/**
 * Regression tests for defects found by the accuracy audit (docs/ACCURACY_VALIDATION.md §8).
 * Each pins behaviour that previously produced a plausible-looking WRONG number.
 */
describe("parseAmount never turns a malformed cell into a wrong number (AV-01)", () => {
  it("reads scientific notation as the number it denotes (was '1e3' -> 13)", () => {
    expect(parseAmount("1e3")).toBe(1000);
    expect(parseAmount("2.5E2")).toBe(250);
  });
  it("rejects ambiguous decimal commas instead of reading them wrongly (was 1.23456 / 15)", () => {
    expect(parseAmount("1.234,56")).toBeUndefined();
    expect(parseAmount("1,5")).toBeUndefined();
  });
  it("rejects multiple decimal points and embedded signs (was 1.2 and -53)", () => {
    expect(parseAmount("1.2.3")).toBeUndefined();
    expect(parseAmount("12.50.00")).toBeUndefined();
    expect(parseAmount("5-3")).toBeUndefined();
    expect(parseAmount("--5")).toBeUndefined();
  });
  it("honours the Unicode minus sign (was read as a positive amount)", () => {
    expect(parseAmount("−5.00")).toBe(-5);
    expect(parseAmount("–120")).toBe(-120);
  });
  it("does not read the '.' of 'Rs.' as a decimal point (was 'Rs.500' -> 0.5)", () => {
    expect(parseAmount("Rs.500")).toBe(500);
    expect(parseAmount("Rs. 2,500")).toBe(2500);
  });
  it("rejects values that overflow to Infinity", () => {
    expect(parseAmount("1e400")).toBeUndefined();
    expect(parseAmount("Infinity")).toBeUndefined();
    expect(parseAmount("-Infinity")).toBeUndefined();
    expect(parseAmount("NaN")).toBeUndefined();
  });
  it("still accepts every legitimate format", () => {
    expect(parseAmount("1,234.50")).toBe(1234.5);
    expect(parseAmount("12,34,567.00")).toBe(1234567);
    expect(parseAmount("(1,200.00)")).toBe(-1200);
    expect(parseAmount("-$5.00")).toBe(-5);
    expect(parseAmount("$-5.00")).toBe(-5);
    expect(parseAmount("5.00-")).toBe(-5);
    expect(parseAmount("USD 500")).toBe(500);
    expect(parseAmount("€ 99.90")).toBe(99.9);
    expect(parseAmount(".50")).toBe(0.5);
    expect(parseAmount("+500")).toBe(500);
  });
  it("rejects non-numbers outright", () => {
    for (const s of ["N/A", "#N/A", "abc", "$", "", "  ", "1 234.56"]) expect(parseAmount(s), s).toBeUndefined();
  });
});

describe("currency on the face of an amount (AV-06)", () => {
  it("reads the currency an amount carries", () => {
    expect(currencyInAmountText("€20.00")).toBe("EUR");
    expect(currencyInAmountText("-£5.00")).toBe("GBP");
    expect(currencyInAmountText("$100")).toBe("USD");
    expect(currencyInAmountText("USD 500")).toBe("USD");
    expect(currencyInAmountText("Rs.500")).toBe("INR");
  });
  it("returns undefined for a bare number or a stray word", () => {
    expect(currencyInAmountText("1,234.50")).toBeUndefined();
    expect(currencyInAmountText("abc")).toBeUndefined();
    expect(currencyInAmountText(1234)).toBeUndefined();
  });
  it("distinguishes A$ / C$ from $ (was always USD)", () => {
    expect(normalizeCurrencyCode("A$5")).toBe("AUD");
    expect(normalizeCurrencyCode("C$5")).toBe("CAD");
  });
});
