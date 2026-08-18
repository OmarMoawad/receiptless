/**
 * Format D — the unwrapped invoice email: labels and amounts run together
 * on one very long line, with no column layout at all.
 *
 * **Found in production, not imagined.** The first real Gmail scan
 * imported a genuine $22.80 invoice as a $0.00 receipt. Its entire body
 * was a single line ending in a support URL, so every other adapter —
 * all of which anchor the amount at end-of-line — found nothing. The
 * receipt was real, the total was printed plainly in the middle of the
 * text, and the parser could not see it (RECEIPTLESS_STATE.md, session
 * 2b's production audit).
 *
 * This is the shape an HTML invoice takes when converted to text without
 * preserved line breaks, which is how a large share of billing email
 * arrives — so it is a format, not a one-off.
 *
 * It sits *after* the structured formats and *before* pos-slip: an email
 * with real line structure should still be read by the adapter built for
 * its structure, and only text with no usable line structure reaches
 * here.
 */
import type { InboundEmail } from "../inbound-email";
import { detectCurrency, merchantFromSender, parseAmountToMinor, parseReceiptDate } from "./text";
import { emptyResult, type AdapterResult, type ReceiptAdapter } from "./types";

/** Below this, a line is normal prose or a real column row, not an unwrapped block. */
const UNWRAPPED_LINE_CHARS = 160;

const AMOUNT = String.raw`([$€£]?\s?\d[\d,]*[.,]\d{2})`;

/**
 * Label patterns, **most specific first**, because an unwrapped invoice
 * prints several amounts in a row and the last number is not the answer:
 *
 *   Subtotal $20.00 Total excluding tax $20.00 VAT (14%) $2.80 Total $22.80 Amount paid $22.80
 *
 * "Amount paid" is what the customer's card was charged, so it wins when
 * present. A bare "Total" is accepted only when it is not part of
 * "Subtotal" and not "Total excluding tax" — both of which are smaller
 * than the real total and would silently understate the receipt.
 */
const LABELLED_TOTALS: { id: string; pattern: RegExp }[] = [
  { id: "amount-paid", pattern: new RegExp(String.raw`\bamount\s+(?:paid|charged)\b[^\d$€£]{0,20}` + AMOUNT, "i") },
  { id: "grand-total", pattern: new RegExp(String.raw`\b(?:grand|order)\s+total\b[^\d$€£]{0,20}` + AMOUNT, "i") },
  { id: "total-due", pattern: new RegExp(String.raw`\btotal\s+due\b[^\d$€£]{0,20}` + AMOUNT, "i") },
  {
    id: "total",
    pattern: new RegExp(
      String.raw`(?<!sub)(?<!sub\s)\btotal\b(?!\s+(?:excluding|before|saved))[^\d$€£]{0,20}` + AMOUNT,
      "i",
    ),
  },
];

function findLabelledTotal(text: string): number | null {
  for (const { pattern } of LABELLED_TOTALS) {
    const match = text.match(pattern);
    if (!match) continue;
    const minor = parseAmountToMinor(match[1]);
    if (minor !== null) return minor;
  }
  return null;
}

/**
 * "Receipt from Acme, PBC $22.80 Paid ..." — the sender line of an
 * unwrapped invoice names the merchant before the first amount. Falls
 * back to the sending domain, same as pos-slip.
 */
function merchantFromInlineHeader(text: string): string | null {
  const match = text.match(/\b(?:receipt|invoice)\s+from\s+(.{2,60}?)\s*(?=[$€£]\s?\d|\(|\[|$)/i);
  const name = match?.[1]?.trim().replace(/[,;:\-–]$/, "");
  return name && name.length > 1 ? name : null;
}

export const inlineSummaryAdapter: ReceiptAdapter = {
  id: "inline-summary",

  /**
   * Claims only text that is genuinely unwrapped *and* carries a labelled
   * amount. Both halves matter: without the length check this would steal
   * ordinary receipts from the adapters built for them, and without the
   * label check it would claim any long paragraph that happens to mention
   * a price.
   */
  detect(email: InboundEmail): boolean {
    const hasUnwrappedLine = email.text.split(/\r?\n/).some((line) => line.trim().length >= UNWRAPPED_LINE_CHARS);
    return hasUnwrappedLine && findLabelledTotal(email.text) !== null;
  },

  parse(email: InboundEmail): AdapterResult {
    return {
      ...emptyResult,
      merchant: merchantFromInlineHeader(email.text) ?? merchantFromSender(email.from),
      totalMinor: findLabelledTotal(email.text),
      currency: detectCurrency(email.text),
      purchasedAt: parseReceiptDate(email.text),
      // Line items are a column concept. This format has no columns, and
      // inventing items by splitting on whitespace would produce
      // confident nonsense — the total is what this adapter can honestly
      // establish.
      items: [],
    };
  },
};
