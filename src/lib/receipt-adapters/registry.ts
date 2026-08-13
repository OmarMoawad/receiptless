/**
 * Adapter dispatch. Ordered most-structural first: an adapter earlier in
 * this list only claims an email whose format it positively recognizes, so
 * the generic point-of-sale fallback at the end is reached only when no
 * stronger signal exists.
 *
 * Adding a genuinely brand-specific adapter later (a retailer whose format
 * fits none of these) means inserting it at the *front* of this array —
 * its narrower detect() runs before the general formats and wins. Nothing
 * else in the pipeline changes, which is the property this registry exists
 * to provide.
 */
import type { InboundEmail } from "../inbound-email";
import { keyValueAdapter } from "./key-value";
import { orderSummaryAdapter } from "./order-summary";
import { posSlipAdapter } from "./pos-slip";
import type { AdapterItem, ReceiptAdapter } from "./types";

export const adapters: ReceiptAdapter[] = [orderSummaryAdapter, keyValueAdapter, posSlipAdapter];

export type ResolvedEmailReceipt = {
  adapterId: string;
  merchant: string;
  totalMinor: number;
  currency: string;
  purchasedAt: Date;
  items: AdapterItem[];
};

export const UNKNOWN_MERCHANT = "Unknown merchant";
const DEFAULT_CURRENCY = "USD";

/** The first adapter whose detect() recognizes the email; never empty (pos-slip always matches). */
export function selectAdapter(email: InboundEmail): ReceiptAdapter {
  return adapters.find((adapter) => adapter.detect(email)) ?? posSlipAdapter;
}

/**
 * A future-dated purchase is always wrong — a receipt records something
 * that already happened — and would sort to the top of the vault forever.
 * A small tolerance absorbs clock skew between the merchant's system and
 * ours rather than rejecting a legitimately just-issued receipt.
 */
const FUTURE_TOLERANCE_MS = 24 * 60 * 60 * 1000;

/**
 * Validates a candidate purchase date against `ingestedAt` — which must be
 * *our own* clock, never anything the sender supplied.
 *
 * This distinction is the whole point of the parameter's name. An earlier
 * version passed the email's own `Date` header in here as the comparison
 * clock, which let a sender defeat the check with the very value being
 * checked: `Date: 2099-01-01` both became the fallback purchase date and
 * raised the future-date ceiling high enough for a printed 2099 date to
 * pass. Every candidate — printed date and email header alike — is now
 * measured against the trusted clock only.
 */
function usableDate(candidate: Date | null, ingestedAt: Date): Date | null {
  if (!candidate || Number.isNaN(candidate.getTime())) return null;
  if (candidate.getTime() > ingestedAt.getTime() + FUTURE_TOLERANCE_MS) return null;
  // Reject implausibly old parses (a mis-read year like 0202) rather than
  // filing the receipt two millennia ago.
  if (candidate.getUTCFullYear() < 2000) return null;
  return candidate;
}

/**
 * Runs the selected adapter and applies the conservative defaults the
 * canonical Receipt object requires. Defaults live here, once, rather than
 * in each adapter — an adapter reporting null means "not found", and this
 * is the single place that decides what "not found" becomes.
 *
 * `ingestedAt` is *our* clock and the only trusted timestamp in play. The
 * purchase date is resolved from three candidates in descending order of
 * trustworthiness, and both untrusted ones must survive validation against
 * `ingestedAt` before they are used:
 *
 *   1. the date printed on the receipt body (untrusted — validated)
 *   2. the email's own Date header (untrusted, sender-set — validated)
 *   3. `ingestedAt` itself (trusted, always usable)
 */
export function resolveEmailReceipt(email: InboundEmail, ingestedAt: Date = new Date()): ResolvedEmailReceipt {
  const adapter = selectAdapter(email);
  const result = adapter.parse(email);
  const merchant = result.merchant?.trim();

  const printedDate = usableDate(result.purchasedAt, ingestedAt);
  const headerDate = usableDate(email.receivedAt, ingestedAt);

  return {
    adapterId: adapter.id,
    merchant: merchant && merchant.length > 0 ? merchant.slice(0, 200) : UNKNOWN_MERCHANT,
    totalMinor: result.totalMinor ?? 0,
    currency: result.currency ?? DEFAULT_CURRENCY,
    purchasedAt: printedDate ?? headerDate ?? ingestedAt,
    items: result.items,
  };
}
