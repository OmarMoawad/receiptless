import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import {
  listUnimportedDeliveries,
  MAX_ATTEMPTS_BEFORE_DISCARD,
  reprocessUnparsedDeliveries,
} from "./delivery-reprocessing";
import type { InboundEmail } from "./inbound-email";
import { ingestEmailForUser } from "./inbound-email-ingestion";

async function createUser(): Promise<string> {
  const user = await prisma.user.create({
    data: { username: `reproc_${randomUUID().replace(/-/g, "").slice(0, 12)}`, passwordHash: "not-a-real-hash" },
  });
  return user.id;
}

function email(overrides: Partial<InboundEmail> = {}): InboundEmail {
  return {
    provider: "gmail",
    providerMessageId: randomUUID(),
    mailboxToken: null,
    from: "receipts@example.com",
    subject: "Your order",
    text: "Thanks for your order.\nNothing here looks like a total.",
    receivedAt: new Date("2026-08-01T10:00:00Z"),
    ...overrides,
  };
}

const PARSEABLE_BODY = ["Brew Bar", "1 x Flat white  3.50", "Total: 3.50 GBP", "Date: 04/07/2026"].join("\n");

describe("an unreadable message", () => {
  it("is retained rather than silently marked seen", async () => {
    const userId = await createUser();
    const result = await ingestEmailForUser(userId, email());

    expect(result.status).toBe("unparseable");
    const delivery = await prisma.inboundEmailDelivery.findFirst({ where: { userId } });
    expect(delivery?.status).toBe("unparsed");
    expect(delivery?.attempts).toBe(1);
    expect(delivery?.retainedEmail).not.toBeNull();
    // The whole point of the finding: before this, the row existed with
    // no receipt and no way back to the message.
    expect(delivery?.receiptId).toBeNull();
  });

  it("becomes a receipt when a parser that can read it runs later", async () => {
    const userId = await createUser();
    const messageId = randomUUID();

    // Arrives as something the parser cannot read...
    await ingestEmailForUser(userId, email({ providerMessageId: messageId }));

    // ...and is then retried. Simulating "a better parser" by retaining a
    // body the current parser *can* read is the honest version of this
    // test: it proves the retry path works end to end, which is the part
    // that was missing, not that any particular parser improved.
    await prisma.inboundEmailDelivery.updateMany({
      where: { userId, providerMessageId: messageId },
      data: {
        retainedEmail: { from: "receipts@example.com", subject: "Your order", text: PARSEABLE_BODY, receivedAt: null },
      },
    });

    const result = await reprocessUnparsedDeliveries(userId);

    expect(result.receiptsCreated).toBe(1);
    const delivery = await prisma.inboundEmailDelivery.findFirst({ where: { userId, providerMessageId: messageId } });
    expect(delivery?.status).toBe("imported");
    expect(delivery?.receiptId).toBeTruthy();
    // Cleared on success — a work queue, not an archive of someone's mail.
    expect(delivery?.retainedEmail).toBeNull();
  });

  it("keeps its place in the queue when it still cannot be read", async () => {
    const userId = await createUser();
    await ingestEmailForUser(userId, email());

    const result = await reprocessUnparsedDeliveries(userId);

    expect(result).toMatchObject({ considered: 1, receiptsCreated: 0, stillUnparsed: 1, discarded: 0 });
    const delivery = await prisma.inboundEmailDelivery.findFirst({ where: { userId } });
    expect(delivery?.status).toBe("unparsed");
    expect(delivery?.attempts).toBe(2);
  });

  it("is retired after enough attempts, so the queue drains", async () => {
    const userId = await createUser();
    await ingestEmailForUser(userId, email());

    // Mail that is simply not a receipt would otherwise be retried on
    // every future call, and the owner's "unparsed" count would never
    // mean anything.
    for (let i = 0; i < MAX_ATTEMPTS_BEFORE_DISCARD; i++) await reprocessUnparsedDeliveries(userId);

    const delivery = await prisma.inboundEmailDelivery.findFirst({ where: { userId } });
    expect(delivery?.status).toBe("discarded");
    // The tombstone keeps the reason and drops the body.
    expect(delivery?.failureReason).toBeTruthy();
    expect(delivery?.retainedEmail).toBeNull();
  });

  it("is never reprocessed for another owner", async () => {
    const mine = await createUser();
    const theirs = await createUser();
    await ingestEmailForUser(mine, email());

    expect(await reprocessUnparsedDeliveries(theirs)).toMatchObject({ considered: 0 });
    expect((await prisma.inboundEmailDelivery.findFirst({ where: { userId: mine } }))?.attempts).toBe(1);
  });
});

describe("plausibility", () => {
  it("refuses a total far too large to be a purchase", async () => {
    const userId = await createUser();
    // A labelled block parses its amount without the OCR path's digit
    // limits, so this is the shape where a wrong-but-well-formed number
    // reaches the store. A wrong total in a vault is worse than a missing
    // one: nothing about it looks wrong later.
    const result = await ingestEmailForUser(
      userId,
      email({
        text: ["Your trip receipt", "", "Merchant: City Rides", "Date: 12 August 2026", "Total: EGP 88123456789.00"].join(
          "\n",
        ),
      }),
    );

    expect(result.status).toBe("unparseable");
    if (result.status === "unparseable") expect(result.reason).toMatch(/implausibly large/);
    expect(await prisma.receipt.count({ where: { ownerId: userId } })).toBe(0);
  });

  it("does not read an order number as an amount by matching its last digits", async () => {
    const userId = await createUser();
    // The bug this found: `AMOUNT_AT_END` could match a suffix of a longer
    // digit run, so "Total: 88123456789.00" on a slip-shaped mail became a
    // confident £789.00 receipt. It must refuse the line, not truncate it.
    const result = await ingestEmailForUser(
      userId,
      email({ text: ["Big Store", "Total: 88123456789.00 GBP"].join("\n") }),
    );

    expect(result.status).toBe("unparseable");
    expect(await prisma.receipt.count({ where: { ownerId: userId } })).toBe(0);
  });

  it("accepts an ordinary total", async () => {
    const userId = await createUser();
    const result = await ingestEmailForUser(userId, email({ text: PARSEABLE_BODY }));
    expect(result.status).toBe("created");
  });
});

describe("the review list", () => {
  it("shows what was skipped and why, with the subject and no body", async () => {
    const userId = await createUser();
    await ingestEmailForUser(userId, email({ subject: "Your weekly newsletter" }));

    const items = await listUnimportedDeliveries(userId);

    expect(items).toHaveLength(1);
    expect(items[0].subject).toBe("Your weekly newsletter");
    expect(items[0].failureReason).toMatch(/no total/);
    expect(items[0].status).toBe("unparsed");
    expect(Object.keys(items[0])).not.toContain("text");
  });

  it("shows only this owner's deliveries", async () => {
    const mine = await createUser();
    const theirs = await createUser();
    await ingestEmailForUser(theirs, email());

    expect(await listUnimportedDeliveries(mine)).toEqual([]);
  });
});
