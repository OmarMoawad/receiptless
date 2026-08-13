import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { prisma } from "./db";
import { registerTestUser } from "@/test/auth-helpers";
import { createFakeGmail, fakeMessage } from "./gmail-fake";
import { scanGmailConnection } from "./gmail-scan";
import { disconnectGmail, getActiveAccessToken } from "./gmail-connection";
import { packTokens, unpackTokens } from "./oauth-token-crypto";

async function connectedMailbox(overrides: { expiresAt?: number } = {}) {
  const user = await registerTestUser();
  const connection = await prisma.emailConnection.create({
    data: {
      userId: user.userId,
      provider: "gmail",
      providerAccountId: `acct-${randomUUID()}`,
      providerAccountEmail: "scanned@gmail.example",
      status: "connected",
      encryptedTokenData: packTokens({
        accessToken: "access-1",
        refreshToken: "refresh-1",
        expiresAt: overrides.expiresAt ?? Date.now() + 3_600_000,
      }),
    },
  });
  return { user, connection };
}

describe("scanGmailConnection", () => {
  it("ingests scanned messages as owner-scoped imported receipts", async () => {
    const { user, connection } = await connectedMailbox();
    const gmail = createFakeGmail({
      messages: [
        fakeMessage({ id: `m-${randomUUID()}`, bodyText: "Corner Shop\nTea $2.00\nTOTAL $2.00" }),
        fakeMessage({ id: `m-${randomUUID()}`, bodyText: "Other Shop\nTOTAL $9.00" }),
      ],
    });

    const result = await scanGmailConnection(connection.id, user.userId, gmail);
    expect(result).toMatchObject({ status: "scanned", messagesSeen: 2, receiptsCreated: 2, failures: 0 });

    const receipts = await prisma.receipt.findMany({ where: { ownerId: user.userId }, include: { merchant: true } });
    expect(receipts).toHaveLength(2);
    expect(receipts.every((receipt) => receipt.source === "EMAIL" && receipt.verification === "IMPORTED")).toBe(true);
  });

  it("records the gmail provider and adapter on the delivery, and is idempotent across re-scans", async () => {
    const { user, connection } = await connectedMailbox();
    const id = `m-${randomUUID()}`;
    const gmail = createFakeGmail({ messages: [fakeMessage({ id })] });

    const first = await scanGmailConnection(connection.id, user.userId, gmail);
    expect(first.receiptsCreated).toBe(1);

    // Re-scanning the same message must not create a second receipt.
    const again = await scanGmailConnection(connection.id, user.userId, gmail);
    expect(again.receiptsCreated).toBe(0);
    expect(again.duplicates).toBe(1);

    const delivery = await prisma.inboundEmailDelivery.findFirst({ where: { providerMessageId: id } });
    expect(delivery?.provider).toBe("gmail");
    expect(delivery?.adapterId).toBeTruthy();
    expect(await prisma.receipt.count({ where: { ownerId: user.userId } })).toBe(1);
  });

  // The roadmap's own requirement for this session.
  it("isolates a failing message so the rest of the mailbox still ingests", async () => {
    const { user, connection } = await connectedMailbox();
    const bad = `m-bad-${randomUUID()}`;
    const gmail = createFakeGmail({
      messages: [
        fakeMessage({ id: `m-${randomUUID()}` }),
        fakeMessage({ id: bad }),
        fakeMessage({ id: `m-${randomUUID()}`, bodyText: "Third Shop\nTOTAL $3.00" }),
      ],
      failingIds: [bad],
    });

    const result = await scanGmailConnection(connection.id, user.userId, gmail);
    expect(result.failures).toBe(1);
    expect(result.receiptsCreated).toBe(2);
    expect(await prisma.receipt.count({ where: { ownerId: user.userId } })).toBe(2);
  });

  it("stops scanning a disconnected account", async () => {
    const { user, connection } = await connectedMailbox();
    const gmail = createFakeGmail({ messages: [fakeMessage({ id: `m-${randomUUID()}` })] });

    expect(await disconnectGmail(connection.id, user.userId)).toBe(true);
    const result = await scanGmailConnection(connection.id, user.userId, gmail);

    expect(result.status).toBe("not-connected");
    expect(result.messagesSeen).toBe(0);
    // Not merely skipped — the token material is actually gone.
    const row = await prisma.emailConnection.findUnique({ where: { id: connection.id } });
    expect(row?.encryptedTokenData).toBeNull();
    expect(gmail.calls.list).toBe(0);
  });

  it("never scans another user's connection", async () => {
    const { connection } = await connectedMailbox();
    const intruder = await registerTestUser();
    const gmail = createFakeGmail({ messages: [fakeMessage({ id: `m-${randomUUID()}` })] });

    const result = await scanGmailConnection(connection.id, intruder.userId, gmail);
    expect(result.status).toBe("not-connected");
    expect(await prisma.receipt.count({ where: { ownerId: intruder.userId } })).toBe(0);
  });

  it("only asks Gmail for mail newer than the last scan", async () => {
    const { user, connection } = await connectedMailbox();
    const gmail = createFakeGmail({
      messages: [fakeMessage({ id: `m-${randomUUID()}`, date: "Tue, 4 Aug 2026 10:15:00 +0000" })],
    });

    await scanGmailConnection(connection.id, user.userId, gmail);
    expect(gmail.lastListOptions?.after).toBeUndefined();

    await scanGmailConnection(connection.id, user.userId, gmail);
    expect(gmail.lastListOptions?.after?.toISOString()).toBe("2026-08-04T10:15:00.000Z");
  });
});

describe("getActiveAccessToken", () => {
  it("returns the stored token when it is not near expiry, without refreshing", async () => {
    const { connection } = await connectedMailbox();
    const gmail = createFakeGmail();
    expect(await getActiveAccessToken(connection.id, gmail)).toBe("access-1");
    expect(gmail.calls.refresh).toBe(0);
  });

  it("refreshes and persists a new access token when near expiry", async () => {
    const { connection } = await connectedMailbox({ expiresAt: Date.now() + 60_000 });
    const gmail = createFakeGmail();

    expect(await getActiveAccessToken(connection.id, gmail)).toBe("access-refreshed");
    expect(gmail.calls.refresh).toBe(1);

    const row = await prisma.emailConnection.findUnique({ where: { id: connection.id } });
    const stored = unpackTokens(row!.encryptedTokenData!);
    expect(stored.accessToken).toBe("access-refreshed");
    // Google omits refresh_token on a normal refresh; the existing one must survive.
    expect(stored.refreshToken).toBe("refresh-1");

    // Immediately after, the fresh token is reused rather than refreshed again.
    expect(await getActiveAccessToken(connection.id, gmail)).toBe("access-refreshed");
    expect(gmail.calls.refresh).toBe(1);
  });

  it("rotates the stored refresh token when Google issues a new one", async () => {
    const { connection } = await connectedMailbox({ expiresAt: Date.now() + 60_000 });
    const gmail = createFakeGmail({
      refreshResponse: { accessToken: "access-2", refreshToken: "refresh-2", expiresInSeconds: 3600 },
    });

    await getActiveAccessToken(connection.id, gmail);
    const row = await prisma.emailConnection.findUnique({ where: { id: connection.id } });
    expect(unpackTokens(row!.encryptedTokenData!).refreshToken).toBe("refresh-2");
  });

  it("returns null for a disconnected connection instead of throwing", async () => {
    const { user, connection } = await connectedMailbox();
    await disconnectGmail(connection.id, user.userId);
    expect(await getActiveAccessToken(connection.id, createFakeGmail())).toBeNull();
  });
});
