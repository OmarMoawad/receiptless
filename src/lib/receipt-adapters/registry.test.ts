import { describe, expect, it } from "vitest";
import { fixtureEmail, KEY_VALUE_TEXT, ORDER_SUMMARY_TEXT, POS_SLIP_TEXT } from "./fixtures";
import { resolveEmailReceipt, selectAdapter, UNKNOWN_MERCHANT } from "./registry";

const NOW = new Date("2026-08-20T12:00:00Z");

describe("format detection", () => {
  it("routes each format to its own adapter", () => {
    expect(selectAdapter(fixtureEmail({ text: ORDER_SUMMARY_TEXT })).id).toBe("order-summary");
    expect(selectAdapter(fixtureEmail({ text: KEY_VALUE_TEXT })).id).toBe("key-value");
    expect(selectAdapter(fixtureEmail({ text: POS_SLIP_TEXT })).id).toBe("pos-slip");
  });

  it("falls back to the slip adapter for unrecognized text, so there is always a parse", () => {
    expect(selectAdapter(fixtureEmail({ text: "hello there" })).id).toBe("pos-slip");
    expect(selectAdapter(fixtureEmail({ text: "" })).id).toBe("pos-slip");
  });

  it("does not treat a shipping notice with an order number as a receipt", () => {
    const text = "Order #A-558210 has shipped. Track it at example.com/track";
    expect(selectAdapter(fixtureEmail({ text })).id).not.toBe("order-summary");
  });
});

describe("order summary format", () => {
  const parsed = resolveEmailReceipt(
    fixtureEmail({ text: ORDER_SUMMARY_TEXT, from: "Beans Coffee <orders@beanscoffee.example>" }),
    NOW,
  );

  it("takes the labelled grand total, not the subtotal or a line item", () => {
    expect(parsed.totalMinor).toBe(1847);
  });

  it("reads the printed order date rather than the ingestion clock", () => {
    expect(parsed.purchasedAt.toISOString()).toBe("2026-07-04T00:00:00.000Z");
  });

  it("keeps quantities and derives unit price from the extended price", () => {
    expect(parsed.items).toEqual([
      { name: "Flat white", quantity: 2, unitPriceMinor: 350, totalPriceMinor: 700 },
      { name: "Almond croissant", quantity: 1, unitPriceMinor: 375, totalPriceMinor: 375 },
      { name: "Sparkling water", quantity: 3, unitPriceMinor: 150, totalPriceMinor: 450 },
    ]);
  });

  it("never turns a totals row into a line item", () => {
    const names = parsed.items.map((item) => item.name.toLowerCase());
    expect(names.some((name) => /subtotal|tax|delivery|total/.test(name))).toBe(false);
  });

  it("uses the sender display name as the merchant", () => {
    expect(parsed.merchant).toBe("Beans Coffee");
  });
});

describe("key/value format", () => {
  const parsed = resolveEmailReceipt(fixtureEmail({ text: KEY_VALUE_TEXT }), NOW);

  it("reads the labelled total and its explicit currency code", () => {
    expect(parsed.totalMinor).toBe(24550);
    expect(parsed.currency).toBe("EGP");
  });

  it("prefers the merchant named in the body over the sending domain", () => {
    expect(parsed.merchant).toBe("City Rides");
  });

  it("parses a written-out date", () => {
    expect(parsed.purchasedAt.toISOString()).toBe("2026-08-12T00:00:00.000Z");
  });

  it("reports no line items rather than inventing one from the total row", () => {
    expect(parsed.items).toEqual([]);
  });
});

describe("point-of-sale slip format", () => {
  const parsed = resolveEmailReceipt(fixtureEmail({ text: POS_SLIP_TEXT }), NOW);

  it("takes the grand total, not the subtotal", () => {
    expect(parsed.totalMinor).toBe(842);
    expect(parsed.currency).toBe("USD");
  });

  it("reads the store name from the top of the slip", () => {
    expect(parsed.merchant).toBe("CORNER GROCERY");
  });

  it("parses the printed date", () => {
    expect(parsed.purchasedAt.toISOString()).toBe("2026-08-01T00:00:00.000Z");
  });
});

describe("conservative defaults", () => {
  it("falls back to the supplied receipt time when no date is printed", () => {
    const parsed = resolveEmailReceipt(fixtureEmail({ text: "Corner Shop\nTOTAL $5.50" }), NOW);
    expect(parsed.purchasedAt).toEqual(NOW);
  });

  it("rejects a future-dated purchase rather than filing it ahead of today", () => {
    const parsed = resolveEmailReceipt(fixtureEmail({ text: "Shop\nDated 2099-01-01\nTOTAL $5.50" }), NOW);
    expect(parsed.purchasedAt).toEqual(NOW);
  });

  it("rejects an implausibly old parsed year", () => {
    const parsed = resolveEmailReceipt(fixtureEmail({ text: "Shop\n0202-01-01\nTOTAL $5.50" }), NOW);
    expect(parsed.purchasedAt).toEqual(NOW);
  });

  it("uses safe placeholders when nothing can be established", () => {
    const parsed = resolveEmailReceipt(fixtureEmail({ text: "", from: "someone@localhost" }), NOW);
    expect(parsed.merchant).toBe(UNKNOWN_MERCHANT);
    expect(parsed.totalMinor).toBe(0);
    expect(parsed.currency).toBe("USD");
    expect(parsed.items).toEqual([]);
  });

  it("does not use a generic mailbox label as a merchant name", () => {
    const parsed = resolveEmailReceipt(fixtureEmail({ text: "", from: "no-reply <no-reply@shopname.example>" }), NOW);
    expect(parsed.merchant).toBe("Shopname");
  });
});
