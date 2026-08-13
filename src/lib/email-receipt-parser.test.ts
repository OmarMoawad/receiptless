import { describe, expect, it } from "vitest";
import type { InboundEmail } from "./inbound-email";
import { parseEmailReceipt } from "./email-receipt-parser";

function email(text: string): InboundEmail {
  return {
    provider: "postmark",
    providerMessageId: "message-1",
    mailboxToken: "mailbox-token",
    from: "shop@example.com",
    subject: "Forwarded receipt",
    text,
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
    const result = parseEmailReceipt(email(""));
    expect(result.merchant).toBe("Unknown merchant");
    expect(result.totalMinor).toBe(0);
    expect(result.currency).toBe("USD");
    expect(result.items).toEqual([]);
    expect(result.purchasedAt).toBeInstanceOf(Date);
  });
});
