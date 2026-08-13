import { describe, it, expect } from "vitest";
import { toIsoDate } from "./dates.js";

describe("toIsoDate", () => {
  it("passes through ISO dates", () => {
    expect(toIsoDate("2024-03-15")).toBe("2024-03-15");
    expect(toIsoDate("2024-03-15T10:00:00Z")).toBe("2024-03-15");
  });
  it("parses DD/MM/YYYY (default assumption)", () => {
    expect(toIsoDate("05/01/2024")).toBe("2024-01-05");
    expect(toIsoDate("15/02/2024")).toBe("2024-02-15");
  });
  it("disambiguates when a field exceeds 12", () => {
    expect(toIsoDate("13/02/2024")).toBe("2024-02-13"); // 13 must be the day
  });
  it("parses month-name formats", () => {
    expect(toIsoDate("Jan 5, 2024")).toBe("2024-01-05");
  });
  it("handles JS Date objects", () => {
    expect(toIsoDate(new Date(Date.UTC(2024, 5, 30)))).toBe("2024-06-30");
  });
  it("returns undefined for junk", () => {
    expect(toIsoDate("not a date")).toBeUndefined();
    expect(toIsoDate(null)).toBeUndefined();
  });
});
