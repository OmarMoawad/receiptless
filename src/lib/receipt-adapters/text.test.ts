import { describe, expect, it } from "vitest";
import { detectCurrency, merchantFromSender, parseAmountToMinor, parseReceiptDate } from "./text";

describe("parseReceiptDate", () => {
  it("reads unambiguous ISO dates, with and without a time", () => {
    expect(parseReceiptDate("2026-08-13")?.toISOString()).toBe("2026-08-13T00:00:00.000Z");
    expect(parseReceiptDate("2026-08-13 14:30")?.toISOString()).toBe("2026-08-13T14:30:00.000Z");
  });

  it("reads written-out dates in either order", () => {
    expect(parseReceiptDate("13 August 2026")?.toISOString()).toBe("2026-08-13T00:00:00.000Z");
    expect(parseReceiptDate("August 13, 2026")?.toISOString()).toBe("2026-08-13T00:00:00.000Z");
    expect(parseReceiptDate("13 Aug 2026")?.toISOString()).toBe("2026-08-13T00:00:00.000Z");
  });

  // Date.UTC rolls impossible dates forward silently; these must be
  // rejected rather than quietly filed under the wrong day.
  it("rejects impossible calendar days instead of rolling them into the next month", () => {
    expect(parseReceiptDate("2026-02-31")).toBeNull();
    expect(parseReceiptDate("2026-04-31")).toBeNull();
    expect(parseReceiptDate("2026-13-01")).toBeNull();
    expect(parseReceiptDate("2026-00-10")).toBeNull();
    expect(parseReceiptDate("31 February 2026")).toBeNull();
  });

  it("respects leap years in both directions", () => {
    expect(parseReceiptDate("2024-02-29")?.toISOString()).toBe("2024-02-29T00:00:00.000Z");
    expect(parseReceiptDate("29 February 2024")?.toISOString()).toBe("2024-02-29T00:00:00.000Z");
    expect(parseReceiptDate("2025-02-29")).toBeNull();
    expect(parseReceiptDate("29 February 2025")).toBeNull();
  });

  it("rejects impossible times", () => {
    expect(parseReceiptDate("2026-08-13 25:00")).toBeNull();
    expect(parseReceiptDate("2026-08-13 12:70")).toBeNull();
  });

  it("returns null for text with no readable date", () => {
    expect(parseReceiptDate("no date here")).toBeNull();
    expect(parseReceiptDate("")).toBeNull();
    // Ambiguous numeric ordering is deliberately not guessed at.
    expect(parseReceiptDate("03/04/2026")).toBeNull();
  });
});

describe("parseAmountToMinor", () => {
  it("handles both decimal conventions and thousands grouping", () => {
    expect(parseAmountToMinor("$12.99")).toBe(1299);
    expect(parseAmountToMinor("12,99")).toBe(1299);
    expect(parseAmountToMinor("1,234.56")).toBe(123456);
    expect(parseAmountToMinor("1.234,56")).toBe(123456);
  });

  it("refuses values with no two-digit fractional part, so a quantity is never an amount", () => {
    expect(parseAmountToMinor("2")).toBeNull();
    expect(parseAmountToMinor("12.9")).toBeNull();
    expect(parseAmountToMinor("")).toBeNull();
  });
});

describe("detectCurrency", () => {
  it("prefers an explicit ISO code over a bare symbol", () => {
    expect(detectCurrency("Total: EGP 245.50")).toBe("EGP");
    expect(detectCurrency("Total: $12.00")).toBe("USD");
    expect(detectCurrency("Total: 12.00")).toBeNull();
  });
});

describe("merchantFromSender", () => {
  it("prefers a real display name", () => {
    expect(merchantFromSender("Beans Coffee <orders@beans.example>")).toBe("Beans Coffee");
  });

  it("falls back to the domain for generic mailbox labels", () => {
    expect(merchantFromSender("no-reply <no-reply@shopname.example>")).toBe("Shopname");
    expect(merchantFromSender("receipts@shopname.co.uk")).toBe("Shopname");
  });

  it("returns null when there is nothing usable", () => {
    expect(merchantFromSender("someone@localhost")).toBeNull();
  });
});
