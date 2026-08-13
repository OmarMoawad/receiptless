/**
 * Session 6 introduced this as a thin wrapper over receipt-ocr-parser.ts.
 * Session 7 moved the actual parsing behind the format-adapter registry
 * (receipt-adapters/) so an email's structure picks the parser, rather
 * than every email being run through the OCR slip heuristics regardless
 * of its shape. The exported shape is unchanged for callers.
 */
import type { InboundEmail } from "./inbound-email";
import { resolveEmailReceipt } from "./receipt-adapters/registry";

export type ParsedEmailReceipt = {
  /** Which format adapter produced this — recorded on the receipt for debugging. */
  adapterId: string;
  merchant: string;
  totalMinor: number;
  currency: string;
  purchasedAt: Date;
  items: Array<{ name: string; quantity: number; unitPriceMinor: number; totalPriceMinor: number }>;
};

/**
 * `ingestedAt` must be the caller's own clock — it is the trusted
 * reference the untrusted candidate dates (the printed date and the
 * email's sender-set `Date` header) are validated against. Never pass a
 * value derived from the email itself; see resolveEmailReceipt.
 */
export function parseEmailReceipt(email: InboundEmail, ingestedAt: Date = new Date()): ParsedEmailReceipt {
  return resolveEmailReceipt(email, ingestedAt);
}
