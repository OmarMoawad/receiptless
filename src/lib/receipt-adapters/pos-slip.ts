/**
 * Format C — the printed point-of-sale slip: a store name at the top, an
 * unlabelled column of item/price rows, and a "TOTAL" line near the
 * bottom. This is the format an in-store receipt emailed as plain text
 * (or converted from HTML by postmark-inbound.ts) arrives in.
 *
 * Unlike formats A and B this one has no structural marker to key on, so
 * it is the registry's last resort (see registry.ts) and delegates to
 * receipt-ocr-parser.ts's existing heuristics — the same code path
 * Session 5's photo OCR feeds, which is exactly where those tolerant,
 * hard-won rules ("Total Saved" is not a total, etc.) already live. Format
 * C is therefore a thin bridge, not a reimplementation: one parser for
 * "unstructured receipt text", whichever connector produced it.
 */
import type { InboundEmail } from "../inbound-email";
import { parseReceiptText } from "../receipt-ocr-parser";
import { emptyResult, type AdapterResult, type ReceiptAdapter } from "./types";
import { merchantFromSender, parseReceiptDate } from "./text";

export const posSlipAdapter: ReceiptAdapter = {
  id: "pos-slip",

  /** The fallback format: always applicable, so the registry always has an answer. */
  detect(): boolean {
    return true;
  },

  parse(email: InboundEmail): AdapterResult {
    const suggestion = parseReceiptText(email.text);
    return {
      ...emptyResult,
      // The slip's own top line is the store name when it parsed; the
      // sending domain is a weaker but still useful fallback.
      merchant: suggestion.merchant ?? merchantFromSender(email.from),
      totalMinor: suggestion.totalMinor,
      currency: suggestion.currency,
      purchasedAt: parseReceiptDate(email.text),
      // parseReceiptText reports a flat price per row with no quantity
      // column, so each row is one unit — the extended price equals the
      // unit price by construction here.
      items: suggestion.items.map((item) => ({
        name: item.name,
        quantity: 1,
        unitPriceMinor: item.priceMinor,
        totalPriceMinor: item.priceMinor,
      })),
    };
  },
};
