import { describe, it, expect } from "vitest";
import { categorize } from "./categorize.js";

/**
 * Regression tests for the three categoriser rules introduced by D23 (token boundaries,
 * longest match wins, direction awareness). Each `it` was verified to fail on commit cc9d6a9.
 *
 * These assert the *rules*, not the specific descriptions the benchmark happens to contain:
 * every case below is paired with a sibling that the same rule has to get right for the
 * opposite reason.
 */

const cat = (text: string, direction?: "inflow" | "outflow"): string => categorize(text, direction).category;

describe("rule 1 — a keyword matches whole words only", () => {
  it("does not let 'water' claim a word that merely starts with it", () => {
    expect(cat("Waterfront hotel stay")).toBe("travel");
  });

  it("still matches 'water' when it is genuinely the word", () => {
    expect(cat("Water bill March")).toBe("utilities");
  });

  it("reads punctuation as a boundary, so a hyphenated phrase tokenizes", () => {
    expect(cat("Rent-a-car Hertz")).toBe("transport");
  });

  it("leaves a plain rent payment as housing", () => {
    expect(cat("Rent for April")).toBe("housing");
  });
});

describe("rule 2 — the longest matching keyword wins, not the first declared", () => {
  it("prefers the 'gas bill' utility over the bare fuel sense", () => {
    expect(cat("Gas bill quarterly")).toBe("utilities");
  });

  it("reads bare 'gas' in a vehicle context as fuel", () => {
    expect(cat("Gas for the car")).toBe("transport");
  });

  it("prefers 'water park' over 'water'", () => {
    expect(cat("Water park tickets")).toBe("entertainment");
  });

  it("prefers 'credit card' over 'credit'", () => {
    expect(cat("Credit card payment")).toBe("transfer");
  });
});

describe("rule 3 — direction, when supplied, rules out impossible categories", () => {
  it("cannot read an outflow as income because it mentions interest", () => {
    expect(cat("Interest charge", "outflow")).toBe("fees");
  });

  it("still reads interest received on an inflow as income", () => {
    expect(cat("Interest paid on savings", "inflow")).toBe("income");
  });

  it("does not assign a spending category to an inflow", () => {
    // A supermarket refund is money arriving; "groceries" would carry the wrong sign sense.
    expect(cat("Supermarket", "inflow")).not.toBe("groceries");
  });

  it("behaves as a pure function of the text when no direction is supplied", () => {
    expect(cat("Supermarket")).toBe("groceries");
  });
});

describe("unchanged behaviour the rules must not disturb", () => {
  it.each([
    ["Monthly salary ACME", "salary"],
    ["TESCO SUPERMARKET", "groceries"],
    ["Starbucks coffee", "dining"],
    ["Netflix subscription", "subscriptions"],
    ["Uber trip", "transport"],
    ["Dr Patel clinic", "health"],
    ["Flight to Lisbon", "travel"],
    ["ATM withdrawal", "transfer"],
  ])("still categorizes %s as %s", (text, expected) => {
    expect(cat(text)).toBe(expected);
  });

  it("returns uncategorized rather than guessing", () => {
    expect(cat("Zzyzx 4417")).toBe("uncategorized");
  });
});

describe("rule 1, corrected — a plural in the description matches a singular keyword (D24)", () => {
  // D23's token-boundary rule removed the substring match that used to catch these, so they
  // regressed to `uncategorized` between the D23 commit and D24. Each of these fails on e1dfa89.
  it.each([
    ["Bank charges", "fees"],
    ["Monthly account fees", "fees"],
    ["Overdraft charges", "fees"],
    ["Cinema tickets for two movies", "entertainment"],
  ])("categorizes %s as %s", (text, expected) => {
    expect(cat(text, "outflow")).toBe(expected);
  });

  it("keeps a singular keyword working", () => {
    expect(cat("Late payment fee", "outflow")).toBe("fees");
  });

  it("does not let pluralisation change which keyword wins", () => {
    // "gas bill" must still outrank "gas" even when the text says "bills".
    expect(cat("Quarterly gas bills", "outflow")).toBe("utilities");
  });

  it("does not mangle a keyword that simply ends in s", () => {
    expect(cat("Filled up with gas", "outflow")).toBe("transport");
  });
});
