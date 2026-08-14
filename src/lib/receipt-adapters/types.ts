/**
 * Session 7 (RECEIPTLESS_STATE.md): parser adapters keyed on a receipt's
 * *structural format*, not on a retailer brand name.
 *
 * ROADMAP.md's Phase 1 bullet calls these "per-retailer parser adapters",
 * and this file deliberately implements the generalization of that rather
 * than the literal reading — decided with Omar, 2026-08-13. A brand-keyed
 * adapter ("the Carrefour adapter") only ever helps the one retailer it
 * names, and silently does nothing the first time that retailer restyles
 * its receipt email. The formats below (an itemized order summary, a
 * labelled key/value block, a printed point-of-sale slip) each cover many
 * retailers at once, and a brand-specific adapter can still be layered on
 * top later for a retailer whose format genuinely doesn't fit — see
 * registry.ts for where such an adapter would slot in.
 */
import type { InboundEmail } from "../inbound-email";

export type AdapterItem = {
  name: string;
  quantity: number;
  unitPriceMinor: number;
  totalPriceMinor: number;
};

/**
 * Everything an adapter can establish from the email on its own. All of it
 * is optional: an adapter reports only what it actually found, and the
 * registry fills the gaps (see resolveEmailReceipt) rather than each
 * adapter inventing its own defaults. `null` therefore means "this adapter
 * could not determine it", never "the receipt says zero".
 */
export type AdapterResult = {
  merchant: string | null;
  totalMinor: number | null;
  currency: string | null;
  purchasedAt: Date | null;
  items: AdapterItem[];
};

export type ReceiptAdapter = {
  /** Stable identifier, recorded on the parse result for debugging/telemetry. */
  id: string;
  /**
   * Whether this adapter recognizes the email's format at all. Kept
   * separate from parse() so the registry can pick a format before paying
   * to parse with it, and so "recognized but yielded nothing" stays
   * distinguishable from "not this format" (see registry.ts).
   */
  detect: (email: InboundEmail) => boolean;
  parse: (email: InboundEmail) => AdapterResult;
};

export const emptyResult: AdapterResult = {
  merchant: null,
  totalMinor: null,
  currency: null,
  purchasedAt: null,
  items: [],
};
