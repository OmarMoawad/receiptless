import type { InboundEmail } from "./inbound-email";
import { parseReceiptText } from "./receipt-ocr-parser";

export type ParsedEmailReceipt = {
  merchant: string;
  totalMinor: number;
  currency: string;
  purchasedAt: Date;
  items: Array<{ name: string; quantity: number; unitPriceMinor: number; totalPriceMinor: number }>;
};

export function parseEmailReceipt(email: InboundEmail): ParsedEmailReceipt {
  const suggestion = parseReceiptText(email.text);
  return {
    merchant: suggestion.merchant ?? "Unknown merchant",
    totalMinor: suggestion.totalMinor ?? 0,
    currency: suggestion.currency ?? "USD",
    purchasedAt: new Date(),
    items: suggestion.items.map((item) => ({
      name: item.name,
      quantity: 1,
      unitPriceMinor: item.priceMinor,
      totalPriceMinor: item.priceMinor,
    })),
  };
}
