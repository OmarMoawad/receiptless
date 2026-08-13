import { prisma } from "./db";
import { parseEmailReceipt } from "./email-receipt-parser";
import type { InboundEmail } from "./inbound-email";

export type InboundEmailIngestionResult =
  | { status: "created"; receiptId: string }
  | { status: "duplicate" | "unknown-mailbox" };

function isUniqueConflict(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

export async function ingestInboundEmail(email: InboundEmail): Promise<InboundEmailIngestionResult> {
  const address = await prisma.inboundEmailAddress.findUnique({ where: { mailboxToken: email.mailboxToken } });
  if (!address) return { status: "unknown-mailbox" };

  try {
    return await prisma.$transaction(async (tx) => {
      const delivery = await tx.inboundEmailDelivery.create({
        data: { provider: email.provider, providerMessageId: email.providerMessageId, userId: address.userId },
      });
      const parsed = parseEmailReceipt(email);
      const merchant = await tx.merchant.upsert({
        where: { name: parsed.merchant },
        update: {},
        create: { name: parsed.merchant },
      });
      const receipt = await tx.receipt.create({
        data: {
          ownerId: address.userId,
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
      await tx.inboundEmailDelivery.update({ where: { id: delivery.id }, data: { receiptId: receipt.id } });
      return { status: "created" as const, receiptId: receipt.id };
    });
  } catch (error) {
    if (isUniqueConflict(error)) return { status: "duplicate" };
    throw error;
  }
}
