import { Prisma } from "@/generated/prisma/client";
import { prisma } from "./db";
import { parseEmailReceipt } from "./email-receipt-parser";
import type { InboundEmail } from "./inbound-email";

/**
 * Bounds on a total that any real retail receipt satisfies, used to catch
 * a confidently-parsed but nonsense number (review #8's "plausibility
 * checks"). Deliberately wide: the job is to reject an order id or a
 * phone number read as money, not to second-guess an unusual purchase.
 * A tighter bound would silently drop real receipts, which is the failure
 * mode this whole session exists to stop.
 */
export const MIN_PLAUSIBLE_TOTAL_MINOR = 1; // a zero total is not a purchase
export const MAX_PLAUSIBLE_TOTAL_MINOR = 100_000_000; // 1,000,000.00 major units

export function implausibleTotalReason(totalMinor: number): string | null {
  if (!Number.isInteger(totalMinor)) return "parsed total was not a whole number of minor units";
  if (totalMinor < MIN_PLAUSIBLE_TOTAL_MINOR) return "parsed total was zero or negative";
  if (totalMinor > MAX_PLAUSIBLE_TOTAL_MINOR) {
    return "parsed total was implausibly large — likely an order number or a phone number read as an amount";
  }
  return null;
}

/**
 * What gets kept so a later parser can try again. Only the fields the
 * parser reads — not headers, not attachments, not the raw MIME.
 */
export type RetainedEmail = {
  from: string | null;
  subject: string | null;
  text: string;
  receivedAt: string | null;
};

export function toRetainedEmail(email: InboundEmail): RetainedEmail {
  return {
    from: email.from ?? null,
    subject: email.subject ?? null,
    text: email.text,
    receivedAt: email.receivedAt ? email.receivedAt.toISOString() : null,
  };
}

async function markUnparsed(
  tx: Prisma.TransactionClient,
  deliveryId: string,
  email: InboundEmail,
  adapterId: string | null,
  reason: string,
): Promise<InboundEmailIngestionResult> {
  await tx.inboundEmailDelivery.update({
    where: { id: deliveryId },
    data: {
      adapterId,
      status: "unparsed",
      failureReason: reason,
      retainedEmail: toRetainedEmail(email) as unknown as Prisma.InputJsonValue,
      attempts: { increment: 1 },
      lastAttemptAt: new Date(),
    },
  });
  return { status: "unparseable" as const, reason };
}

export type InboundEmailIngestionResult =
  | { status: "created"; receiptId: string }
  /**
   * The parser could not find a total. Reported rather than stored,
   * because a receipt with no amount is not a receipt — see registry.ts.
   * Distinct from "duplicate" so a scan can tell the owner how much of
   * their mail it actually understood.
   */
  | { status: "unparseable"; reason: string }
  | { status: "duplicate" | "unknown-mailbox" };

function isUniqueConflict(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

/**
 * Session 6's forward-to path: resolve the owning user from the mailbox
 * token, then ingest. Routing happens only through the server-resolved
 * token, never through any address the sender chose.
 */
export async function ingestInboundEmail(email: InboundEmail): Promise<InboundEmailIngestionResult> {
  if (!email.mailboxToken) return { status: "unknown-mailbox" };
  const address = await prisma.inboundEmailAddress.findUnique({ where: { mailboxToken: email.mailboxToken } });
  if (!address) return { status: "unknown-mailbox" };
  return ingestEmailForUser(address.userId, email);
}

/**
 * The ingestion core, for a user the caller has already established.
 *
 * Session 9's OAuth scan enters here directly: it knows whose mailbox it
 * is reading from the EmailConnection row, so there is no token to
 * resolve. Extracted rather than duplicated so both connectors inherit the
 * same idempotency, the same merchant-metadata protection, and the same
 * trusted-clock date handling.
 */
/**
 * Parses one message against an **existing** delivery row and, if it
 * yields a usable receipt, creates the receipt and links the row to it —
 * all inside the caller's transaction.
 *
 * Extracted so that first-time ingestion and reprocessing share one
 * implementation rather than two that drift. It takes a delivery id
 * rather than creating one, which is what lets reprocessing reuse a row
 * instead of deleting and recreating it: an earlier version deleted the
 * row first, and a process killed between the delete and the re-insert
 * lost the retained message permanently, with the Gmail cursor already
 * past it. A `catch` cannot help there — a killed process runs no
 * `catch`. Not deleting is the only fix that holds.
 */
async function applyParsedReceipt(
  tx: Prisma.TransactionClient,
  userId: string,
  deliveryId: string,
  email: InboundEmail,
): Promise<InboundEmailIngestionResult> {
  // Our own clock, deliberately — the email's Date header is
      // sender-controlled and is validated against this inside the parser
      // rather than replacing it. Passing email.receivedAt here would let
      // a spoofed header both set and authorize its own purchase date.
  const parsed = parseEmailReceipt(email, new Date());

      // The one field a receipt cannot do without. Previously a missing
      // total defaulted to zero and a receipt was created anyway, so an
      // unreadable email — or an email that was never a receipt — became a
      // $0.00 entry in the vault and counted as a successful import.
      //
      // Review findings #6/#7: the delivery row is still written, because
      // idempotency depends on it, but it is now written as **retryable**
      // rather than as a silent tombstone. Before this, the row marked
      // the message seen, the Gmail cursor moved past it, and no future
      // parser could ever reach it again. The message itself is retained
      // on the row so `reprocessUnparsedDeliveries` can run a better
      // parser over it later without re-fetching from Gmail — which
      // forwarded mail could not do at all, since Postmark keeps nothing.
  if (parsed.totalMinor === null) {
    return await markUnparsed(tx, deliveryId, email, parsed.adapterId, "no total could be parsed from this message");
  }

      // Plausibility, not just parseability (review #8). A number the
      // parser is confident about can still be nonsense — a phone number
      // or an order id read as a total — and a wrong amount in a vault is
      // worse than a missing one, because nothing about it looks wrong
      // later. Out-of-range values are treated exactly like an unreadable
      // total: retained, reviewable, reprocessable.
  const implausible = implausibleTotalReason(parsed.totalMinor);
  if (implausible) {
    return await markUnparsed(tx, deliveryId, email, parsed.adapterId, implausible);
  }

  const merchant = await tx.merchant.upsert({
    where: { name: parsed.merchant },
    update: {},
    create: { name: parsed.merchant },
  });
  const receipt = await tx.receipt.create({
    data: {
      ownerId: userId,
      merchantId: merchant.id,
      currency: parsed.currency,
      totalMinor: parsed.totalMinor,
      purchasedAt: parsed.purchasedAt,
      source: "EMAIL",
      verification: "IMPORTED",
      rawPayload: email.text,
      items: parsed.items.length ? { create: parsed.items } : undefined,
    },
  });
  await tx.inboundEmailDelivery.update({
    where: { id: deliveryId },
    data: {
      receiptId: receipt.id,
      adapterId: parsed.adapterId,
      status: "imported",
      failureReason: null,
      // Cleared on success: the retained copy is a work queue entry,
      // not an archive. The receipt keeps its own rawPayload.
      retainedEmail: Prisma.DbNull,
      attempts: { increment: 1 },
      lastAttemptAt: new Date(),
    },
  });
  return { status: "created" as const, receiptId: receipt.id };
}

export async function ingestEmailForUser(userId: string, email: InboundEmail): Promise<InboundEmailIngestionResult> {
  try {
    return await prisma.$transaction(async (tx) => {
      const delivery = await tx.inboundEmailDelivery.create({
        data: { provider: email.provider, providerMessageId: email.providerMessageId, userId },
      });
      return await applyParsedReceipt(tx, userId, delivery.id, email);
    });
  } catch (error) {
    if (isUniqueConflict(error)) return { status: "duplicate" };
    throw error;
  }
}

/**
 * Re-runs the current parser over a delivery that already exists, without
 * ever removing it. See applyParsedReceipt for why that matters.
 */
export async function reapplyToExistingDelivery(
  userId: string,
  deliveryId: string,
  email: InboundEmail,
): Promise<InboundEmailIngestionResult> {
  return prisma.$transaction(async (tx) => applyParsedReceipt(tx, userId, deliveryId, email));
}
