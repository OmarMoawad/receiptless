import { describe, expect, it } from "vitest";
import { formatMinorUnits, fromMinorUnits, toMinorUnits } from "./money";

describe("toMinorUnits", () => {
  it("converts a decimal amount to integer cents", () => {
    expect(toMinorUnits(12.5)).toBe(1250);
    expect(toMinorUnits(0.1)).toBe(10);
  });

  it("rounds rather than truncating floating-point noise", () => {
    // 0.1 + 0.2 in IEEE754 is 0.30000000000000004 — this is exactly the
    // class of bug integer minor units exists to avoid everywhere else in
    // the codebase; this helper itself must round correctly too.
    expect(toMinorUnits(0.1 + 0.2)).toBe(30);
  });
});

describe("fromMinorUnits", () => {
  it("is the inverse of toMinorUnits for whole cents", () => {
    expect(fromMinorUnits(1250)).toBe(12.5);
    expect(fromMinorUnits(1)).toBe(0.01);
  });
});

describe("formatMinorUnits", () => {
  it("formats as a localized currency string", () => {
    expect(formatMinorUnits(1250, "USD")).toBe("$12.50");
  });

  it("respects a different currency code", () => {
    expect(formatMinorUnits(1250, "EUR")).toContain("12.50");
  });
});
