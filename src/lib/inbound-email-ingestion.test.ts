import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { prisma } from "./db";
import type { InboundEmail } from "./inbound-email";
import { ingestInboundEmail } from "./inbound-email-ingestion";
import { registerTestUser } from "@/test/auth-helpers";

function email(mailboxToken: string, overrides: Partial<InboundEmail> = {}): InboundEmail {
  return {
    provider: "postmark",
    providerMessageId: randomUUID(),
    mailboxToken,
    from: "store@example.com",
    subject: "Receipt",
    text: "Immutable Merchant\nTea $2.00\nTOTAL $2.00",
    receivedAt: null,
    ...overrides,
  };
}

describe("ingestInboundEmail", () => {
  it("routes only by mailbox token and creates an imported email receipt", async () => {
    const user = await registerTestUser();
    const mailboxToken = randomUUID();
    await prisma.inboundEmailAddress.create({ data: { userId: user.userId, mailboxToken } });

    const result = await ingestInboundEmail(email(mailboxToken));
    expect(result.status).toBe("created");
    if (result.status !== "created") throw new Error("expected created");

    const receipt = await prisma.receipt.findUnique({ where: { id: result.receiptId }, include: { items: true } });
    expect(receipt).toMatchObject({ ownerId: user.userId, source: "EMAIL", verification: "IMPORTED", totalMinor: 200 });
    expect(receipt?.items).toHaveLength(1);
  });

  it("acknowledges unknown mailboxes and duplicate provider deliveries without creating twice", async () => {
    expect((await ingestInboundEmail(email("unknown-token"))).status).toBe("unknown-mailbox");

    const user = await registerTestUser();
    const mailboxToken = randomUUID();
    await prisma.inboundEmailAddress.create({ data: { userId: user.userId, mailboxToken } });
    const delivery = email(mailboxToken);
    const first = await ingestInboundEmail(delivery);
    const second = await ingestInboundEmail(delivery);
    expect(first.status).toBe("created");
    expect(second.status).toBe("duplicate");
    expect(await prisma.inboundEmailDelivery.count({ where: { providerMessageId: delivery.providerMessageId } })).toBe(1);
  });

  it("never mutates shared merchant metadata from sender-controlled content", async () => {
    await prisma.merchant.upsert({
      where: { name: "Immutable Merchant" },
      update: { website: "https://trusted.example" },
      create: { name: "Immutable Merchant", website: "https://trusted.example" },
    });
    const user = await registerTestUser();
    const mailboxToken = randomUUID();
    await prisma.inboundEmailAddress.create({ data: { userId: user.userId, mailboxToken } });
    await ingestInboundEmail(email(mailboxToken));
    expect((await prisma.merchant.findUnique({ where: { name: "Immutable Merchant" } }))?.website).toBe("https://trusted.example");
  });

  it("records which format adapter parsed the delivery", async () => {
    const user = await registerTestUser();
    const mailboxToken = randomUUID();
    await prisma.inboundEmailAddress.create({ data: { userId: user.userId, mailboxToken } });
    const delivery = email(mailboxToken);
    await ingestInboundEmail(delivery);
    const row = await prisma.inboundEmailDelivery.findFirst({
      where: { providerMessageId: delivery.providerMessageId },
    });
    expect(row?.adapterId).toBe("pos-slip");
  });

  it("dates the receipt from the email, not the ingestion clock", async () => {
    const user = await registerTestUser();
    const mailboxToken = randomUUID();
    await prisma.inboundEmailAddress.create({ data: { userId: user.userId, mailboxToken } });
    const receivedAt = new Date("2026-06-15T08:00:00Z");
    const result = await ingestInboundEmail(email(mailboxToken, { receivedAt }));
    if (result.status !== "created") throw new Error("expected created");
    const receipt = await prisma.receipt.findUnique({ where: { id: result.receiptId } });
    expect(receipt?.purchasedAt).toEqual(receivedAt);
  });
});
