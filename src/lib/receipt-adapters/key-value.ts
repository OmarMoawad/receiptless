/**
 * Format B — the labelled key/value receipt. No itemization at all: a
 * short block of "Label: value" pairs, which is what ride-hailing, fuel,
 * parking, subscription-renewal and most single-charge receipts look like.
 *
 * These have no line items to find, and pretending otherwise is actively
 * harmful — the point-of-sale adapter's "any line with a trailing amount
 * is an item" heuristic turns "Total: $18.40" into a phantom line item on
 * exactly this format. Recognizing the shape explicitly is what stops that.
 */
import type { InboundEmail } from "../inbound-email";
import { emptyResult, type AdapterResult, type ReceiptAdapter } from "./types";
import { detectCurrency, merchantFromSender, parseAmountToMinor, parseReceiptDate } from "./text";

const LABELLED_TOTAL = /^\s*(total|amount|amount\s+(?:paid|charged|due)|charged|payment|fare)\s*[:\-]\s*(.+?)\s*$/i;
const LABELLED_DATE = /^\s*(date|purchased|charged\s+on|transaction\s+date)\s*[:\-]\s*(.+?)\s*$/i;
const LABELLED_MERCHANT = /^\s*(merchant|business|store|vendor|from)\s*[:\-]\s*(.+?)\s*$/i;
const ANY_LABEL = /^\s*[A-Za-z][A-Za-z /]{1,28}\s*[:\-]\s*\S/;

function firstLabelled(lines: string[], label: RegExp): string | null {
  for (const line of lines) {
    const match = line.match(label);
    if (match) return match[2].trim();
  }
  return null;
}

export const keyValueAdapter: ReceiptAdapter = {
  id: "key-value",

  detect(email: InboundEmail): boolean {
    const lines = email.text.split("\n").map((line) => line.trim()).filter(Boolean);
    if (lines.length === 0) return false;
    if (!lines.some((line) => LABELLED_TOTAL.test(line))) return false;
    // A labelled total inside an otherwise itemized receipt isn't this
    // format — require the body to be *predominantly* label/value pairs.
    const labelled = lines.filter((line) => ANY_LABEL.test(line)).length;
    return labelled >= 2 && labelled >= lines.length / 2;
  },

  parse(email: InboundEmail): AdapterResult {
    const lines = email.text.split("\n").map((line) => line.trim()).filter(Boolean);
    const totalRaw = firstLabelled(lines, LABELLED_TOTAL);
    const dateRaw = firstLabelled(lines, LABELLED_DATE);

    return {
      ...emptyResult,
      // A merchant the body states explicitly outranks one inferred from
      // the sending domain — a forwarded receipt's envelope is the
      // forwarder, but its body still names the real business.
      merchant: firstLabelled(lines, LABELLED_MERCHANT) ?? merchantFromSender(email.from),
      totalMinor: totalRaw ? parseAmountToMinor(totalRaw) : null,
      currency: detectCurrency(email.text),
      purchasedAt: dateRaw ? parseReceiptDate(dateRaw) : parseReceiptDate(email.text),
      items: [],
    };
  },
};
