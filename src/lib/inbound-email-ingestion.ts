import { prisma } from "./db";
import { parseEmailReceipt } from "./email-receipt-parser";
import type { InboundEmail } from "./inbound-email";

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
export async function ingestEmailForUser(userId: string, email: InboundEmail): Promise<InboundEmailIngestionResult> {
  try {
    return await prisma.$transaction(async (tx) => {
      const delivery = await tx.inboundEmailDelivery.create({
        data: { provider: email.provider, providerMessageId: email.providerMessageId, userId },
      });
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
      // The delivery row is still written, so the message is recorded as
      // seen and will not be re-processed on the next scan.
      if (parsed.totalMinor === null) {
        await tx.inboundEmailDelivery.update({
          where: { id: delivery.id },
          data: { adapterId: parsed.adapterId },
        });
        return { status: "unparseable" as const, reason: "no total could be parsed from this message" };
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
        where: { id: delivery.id },
        data: { receiptId: receipt.id, adapterId: parsed.adapterId },
      });
      return { status: "created" as const, receiptId: receipt.id };
    });
  } catch (error) {
    if (isUniqueConflict(error)) return { status: "duplicate" };
    throw error;
  }
}
