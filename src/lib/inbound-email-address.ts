import { randomBytes } from "node:crypto";
import { prisma } from "./db";

export async function getOrCreateInboundEmailAddress(userId: string): Promise<{ mailboxToken: string }> {
  return prisma.inboundEmailAddress.upsert({
    where: { userId },
    update: {},
    create: { userId, mailboxToken: randomBytes(18).toString("base64url") },
    select: { mailboxToken: true },
  });
}

export function formatForwardingAddress(baseAddress: string, mailboxToken: string): string {
  const at = baseAddress.lastIndexOf("@");
  if (at <= 0 || at === baseAddress.length - 1 || baseAddress.includes("+")) {
    throw new Error("POSTMARK_INBOUND_ADDRESS must be a plain email address.");
  }
  return `${baseAddress.slice(0, at)}+${mailboxToken}@${baseAddress.slice(at + 1)}`;
}
