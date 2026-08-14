import { describe, expect, it } from "vitest";
import type { InboundEmail } from "./inbound-email";
import { parseEmailReceipt } from "./email-receipt-parser";

function email(text: string, from = "shop@example.com"): InboundEmail {
  return {
    provider: "postmark",
    providerMessageId: "message-1",
    mailboxToken: "mailbox-token",
    from,
    subject: "Forwarded receipt",
    text,
    receivedAt: null,
  };
}

describe("parseEmailReceipt", () => {
  it("converts receipt suggestions into canonical import values", () => {
    const result = parseEmailReceipt(email("Corner Shop\nTea $2.00\nCake $3.50\nTOTAL $5.50"));
    expect(result).toMatchObject({ merchant: "Corner Shop", totalMinor: 550, currency: "USD" });
    expect(result.items).toEqual([
      { name: "Tea", quantity: 1, unitPriceMinor: 200, totalPriceMinor: 200 },
      { name: "Cake", quantity: 1, unitPriceMinor: 350, totalPriceMinor: 350 },
    ]);
  });

  it("uses conservative defaults when the email cannot establish receipt values", () => {
    // Session 7: the sending domain is now a merchant fallback, so an
    // unparseable body no longer means an unnamed merchant. "Unknown
    // merchant" is reserved for an email that offers neither.
    const result = parseEmailReceipt(email("", "someone@localhost"));
    expect(result.merchant).toBe("Unknown merchant");
    expect(result.totalMinor).toBe(0);
    expect(result.currency).toBe("USD");
    expect(result.items).toEqual([]);
    expect(result.purchasedAt).toBeInstanceOf(Date);
  });

  it("falls back to the sending domain when the body names no merchant", () => {
    expect(parseEmailReceipt(email("")).merchant).toBe("Example");
  });

  it("prefers the email's own received time over the ingestion clock", () => {
    const receivedAt = new Date("2026-07-01T09:30:00Z");
    expect(parseEmailReceipt(email("Corner Shop\nTOTAL $5.50"), receivedAt).purchasedAt).toEqual(receivedAt);
  });
});
