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
 * `receivedAt` is the delivery timestamp used when the email states no
 * readable purchase date. Session 6 always used the ingestion clock here;
 * the adapters now extract a real date when the receipt prints one, so a
 * receipt forwarded days late no longer files under the day it was
 * forwarded.
 */
export function parseEmailReceipt(email: InboundEmail, receivedAt: Date = new Date()): ParsedEmailReceipt {
  return resolveEmailReceipt(email, receivedAt);
}
