import { describe, expect, it } from "vitest";
import type { InboundEmail } from "../inbound-email";
import { INLINE_INVOICE_TEXT, KEY_VALUE_TEXT, POS_SLIP_TEXT } from "./fixtures";
import { inlineSummaryAdapter } from "./inline-summary";
import { selectAdapter } from "./registry";
import { parseEmailReceipt } from "../email-receipt-parser";

function email(text: string, from = "billing@example.test"): InboundEmail {
  return {
    provider: "gmail",
    providerMessageId: "msg-1",
    mailboxToken: null,
    from,
    subject: "Your receipt",
    text,
    receivedAt: null,
  };
}

/**
 * The regression this adapter exists for: a real $22.80 invoice was
 * imported as $0.00 because the whole receipt arrived on one line.
 */
describe("an unwrapped invoice email", () => {
  it("reads the amount actually charged, not the subtotal or the pre-tax total", () => {
    // The line prints, in order: Subtotal 20.00, Total excluding tax
    // 20.00, VAT 2.80, Total 22.80, Amount paid 22.80. Only one of those
    // is what the card was charged.
    const result = inlineSummaryAdapter.parse(email(INLINE_INVOICE_TEXT));
    expect(result.totalMinor).toBe(2280);
    expect(result.currency).toBe("USD");
  });

  it("is the adapter the registry picks for it", () => {
    expect(selectAdapter(email(INLINE_INVOICE_TEXT)).id).toBe("inline-summary");
  });

  it("produces a receipt end to end, where the old parser produced nothing", () => {
    const parsed = parseEmailReceipt(email(INLINE_INVOICE_TEXT), new Date("2026-08-20T00:00:00Z"));
    expect(parsed.totalMinor).toBe(2280);
    expect(parsed.adapterId).toBe("inline-summary");
    expect(parsed.merchant).toBe("Example Cloud, PBC");
    expect(parsed.purchasedAt.toISOString().slice(0, 10)).toBe("2026-08-05");
  });

  it("claims no line items, rather than inventing them from a wall of text", () => {
    // There are no columns here. Splitting on whitespace would produce
    // confident nonsense.
    expect(inlineSummaryAdapter.parse(email(INLINE_INVOICE_TEXT)).items).toEqual([]);
  });
});

describe("what it deliberately does not claim", () => {
  it("leaves a labelled key/value receipt to its own adapter", () => {
    expect(selectAdapter(email(KEY_VALUE_TEXT)).id).toBe("key-value");
  });

  it("leaves a printed point-of-sale slip to its own adapter", () => {
    expect(selectAdapter(email(POS_SLIP_TEXT)).id).toBe("pos-slip");
  });

  it("ignores a long paragraph that merely mentions a price", () => {
    const prose = `Thanks for shopping with us. ${"Our returns policy is generous and detailed. ".repeat(6)}Items are usually 12.99 each.`;
    expect(inlineSummaryAdapter.detect(email(prose))).toBe(false);
  });

  it("ignores a short line even when it is labelled", () => {
    // Short, structured text belongs to the structured adapters.
    expect(inlineSummaryAdapter.detect(email("Total $9.99"))).toBe(false);
  });

  it("does not read a subtotal as the total", () => {
    const text = `Order summary follows. ${"Padding to make this line unwrapped. ".repeat(5)}Subtotal $15.00`;
    expect(inlineSummaryAdapter.detect(email(text))).toBe(false);
  });
});
