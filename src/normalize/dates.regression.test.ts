import { describe, it, expect } from "vitest";
import { isValidCalendarDate, toIsoDate } from "./dates.js";

/** Regression tests for AV-02: impossible or non-date text was accepted as a date. */
describe("calendar validity (AV-02)", () => {
  it("rejects impossible calendar dates (were accepted verbatim)", () => {
    for (const s of ["2024-02-30", "2024-13-01", "2024-00-10", "31/04/2024", "29/02/2023", "30/02/2024", "13/13/2024", "00/00/0000", "2024-06-31"]) {
      expect(toIsoDate(s), s).toBeUndefined();
    }
  });
  it("accepts real dates including leap days", () => {
    expect(toIsoDate("29/02/2024")).toBe("2024-02-29");
    expect(toIsoDate("2024-02-29")).toBe("2024-02-29");
    expect(toIsoDate("2024-12-31T23:59:59")).toBe("2024-12-31");
    expect(isValidCalendarDate(2100, 2, 29)).toBe(false); // 2100 is not a leap year
    expect(isValidCalendarDate(2000, 2, 29)).toBe(true);
  });
  it("does not turn arbitrary text into a date (was 'hello 5' -> 2001-05-01)", () => {
    for (const s of ["hello 5", "abc 12", "tomorrow", "Janet 5, 2024", "Feb 30, 2024", "Apr 31, 2024"]) {
      expect(toIsoDate(s), s).toBeUndefined();
    }
  });
  it("still parses month-name and slash-ISO formats deterministically", () => {
    expect(toIsoDate("Jan 5, 2024")).toBe("2024-01-05");
    expect(toIsoDate("5 January 2024")).toBe("2024-01-05");
    expect(toIsoDate("Mon, 5 Jan 2024")).toBe("2024-01-05");
    expect(toIsoDate("2024/03/15")).toBe("2024-03-15");
    expect(toIsoDate("15.03.2024")).toBe("2024-03-15");
  });
});
