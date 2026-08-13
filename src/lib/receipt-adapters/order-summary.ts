/**
 * Format A — the itemized order summary. The shape most e-commerce and
 * delivery confirmation emails use: an order reference, a block of
 * quantity/description/price rows, then a labelled totals block
 * (subtotal, delivery, tax, order total).
 *
 * Distinguishing feature vs. the point-of-sale slip format: the totals are
 * *labelled* and the grand total is explicitly named ("Order total"), so
 * this adapter never has to guess which trailing amount is the real one —
 * which is exactly the guess receipt-ocr-parser.ts has to make, and the
 * source of the "Total Saved" class of bug logged in Session 5's
 * follow-up.
 */
import type { InboundEmail } from "../inbound-email";
import { emptyResult, type AdapterItem, type AdapterResult, type ReceiptAdapter } from "./types";
import { detectCurrency, merchantFromSender, parseAmountToMinor, parseReceiptDate } from "./text";

const ORDER_REFERENCE = /\border\s*(?:#|no\.?|number|id)\s*[:#]?\s*\w+/i;
const GRAND_TOTAL = /\b(order\s+total|total\s+(?:charged|paid|amount)|amount\s+charged|grand\s+total)\b/i;

// "2 x Flat white  $7.00" / "2 × Flat white  7.00" — an explicit quantity
// marker is what makes this row shape unambiguous, so it is required
// rather than inferred from position.
const QUANTITY_ITEM = /^\s*(\d{1,3})\s*[x×]\s*(.+?)\s{2,}([^\s]*\d[\d.,]*)\s*$/i;
// "Flat white   x2   $7.00" — the same row with the quantity trailing.
const TRAILING_QUANTITY_ITEM = /^\s*(.+?)\s{2,}[x×]\s*(\d{1,3})\s{2,}([^\s]*\d[\d.,]*)\s*$/i;

const TOTALS_LABEL = /\b(sub\s?total|tax|vat|delivery|shipping|service\s+fee|tip|discount|total|balance)\b/i;

function findLabelledAmount(lines: string[], label: RegExp): number | null {
  // Bottom-up: the grand total is printed after any per-item or subtotal
  // rows, and some emails repeat the label in a header/summary above.
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!label.test(lines[i])) continue;
    const amount = lines[i].match(/([^\s]*\d[\d.,]*)\s*$/);
    if (!amount) continue;
    const minor = parseAmountToMinor(amount[1]);
    if (minor !== null) return minor;
  }
  return null;
}

function parseItems(lines: string[]): AdapterItem[] {
  const items: AdapterItem[] = [];
  for (const line of lines) {
    // A totals row can also carry a trailing amount; skip it so "Subtotal"
    // never becomes a line item.
    if (TOTALS_LABEL.test(line)) continue;

    const leading = line.match(QUANTITY_ITEM);
    const trailing = leading ? null : line.match(TRAILING_QUANTITY_ITEM);
    if (!leading && !trailing) continue;

    const quantity = Number(leading ? leading[1] : trailing![2]);
    const name = (leading ? leading[2] : trailing![1]).trim();
    const totalPriceMinor = parseAmountToMinor(leading ? leading[3] : trailing![3]);
    if (!name || totalPriceMinor === null || quantity < 1) continue;

    // The printed amount on these rows is the extended (line) price, so
    // the unit price is derived — not the other way round. Rows that don't
    // divide evenly keep an exact extended total and an approximate unit
    // price, never a total that disagrees with the receipt.
    items.push({
      name,
      quantity,
      unitPriceMinor: Math.round(totalPriceMinor / quantity),
      totalPriceMinor,
    });
  }
  return items;
}

export const orderSummaryAdapter: ReceiptAdapter = {
  id: "order-summary",

  detect(email: InboundEmail): boolean {
    const text = `${email.subject ?? ""}\n${email.text}`;
    // Both signals required: an order reference alone also appears on
    // shipping-notification emails that carry no priced totals at all.
    return ORDER_REFERENCE.test(text) && GRAND_TOTAL.test(email.text);
  },

  parse(email: InboundEmail): AdapterResult {
    const lines = email.text.split("\n").map((line) => line.replace(/\s+$/, ""));
    const compact = lines.map((line) => line.trim()).filter(Boolean);

    return {
      ...emptyResult,
      merchant: merchantFromSender(email.from),
      totalMinor: findLabelledAmount(compact, GRAND_TOTAL),
      currency: detectCurrency(email.text),
      purchasedAt: parseReceiptDate(email.text),
      items: parseItems(lines),
    };
  },
};
