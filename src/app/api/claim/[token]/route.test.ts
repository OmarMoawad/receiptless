import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { cookieHeader, registerTestUser } from "@/test/auth-helpers";
import { GET } from "./route";

async function createClaimableReceipt(overrides: {
  claimTokenExpiresAt?: Date;
  claimedAt?: Date | null;
  ownerId?: string | null;
} = {}) {
  const merchant = await prisma.merchant.create({
    data: { name: `Claim Test Merchant ${randomUUID().slice(0, 8)}` },
  });
  const claimToken = randomUUID();
  const receipt = await prisma.receipt.create({
    data: {
      merchantId: merchant.id,
      totalMinor: 1000,
      purchasedAt: new Date("2026-08-11T10:00:00Z"),
      claimToken,
      claimTokenExpiresAt: overrides.claimTokenExpiresAt ?? new Date(Date.now() + 60_000),
      claimedAt: overrides.claimedAt ?? null,
      ownerId: overrides.ownerId ?? null,
    },
  });
  return { receipt, claimToken };
}

function callGet(token: string, sessionToken?: string) {
  const request = new NextRequest(`http://localhost/api/claim/${token}`, {
    headers: cookieHeader(sessionToken),
  });
  return GET(request, { params: Promise.resolve({ token }) });
}

describe("GET /api/claim/[token]", () => {
  it("rejects an anonymous (logged-out) request without consuming the token", async () => {
    const { claimToken } = await createClaimableReceipt();

    const response = await callGet(claimToken);
    expect(response.status).toBe(401);

    // The token must still be claimable afterward — an unauthenticated
    // request must never burn it.
    const alice = await registerTestUser();
    const followUp = await callGet(claimToken, alice.token);
    expect(followUp.status).toBe(200);
  });

  it("resolves an unclaimed, unexpired token for a signed-in user and attaches ownership", async () => {
    const { claimToken, receipt } = await createClaimableReceipt();
    const alice = await registerTestUser();

    const response = await callGet(claimToken, alice.token);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.id).toBe(receipt.id);
    expect(body.claimedAt).not.toBeNull();

    const stored = await prisma.receipt.findUnique({ where: { id: receipt.id } });
    expect(stored?.ownerId).toBe(alice.userId);
  });

  it("rejects a second resolution of the same token with 409, even for the same user (single-use)", async () => {
    const { claimToken } = await createClaimableReceipt();
    const alice = await registerTestUser();

    const first = await callGet(claimToken, alice.token);
    expect(first.status).toBe(200);

    const second = await callGet(claimToken, alice.token);
    expect(second.status).toBe(409);
  });

  it("rejects a different signed-in user claiming an already-claimed token with 409, and never reassigns ownership", async () => {
    const { claimToken, receipt } = await createClaimableReceipt();
    const alice = await registerTestUser();
    const bob = await registerTestUser();

    const first = await callGet(claimToken, alice.token);
    expect(first.status).toBe(200);

    const second = await callGet(claimToken, bob.token);
    expect(second.status).toBe(409);

    const stored = await prisma.receipt.findUnique({ where: { id: receipt.id } });
    expect(stored?.ownerId).toBe(alice.userId);
  });

  it("rejects an unknown token with 404", async () => {
    const alice = await registerTestUser();
    const response = await callGet(randomUUID(), alice.token);
    expect(response.status).toBe(404);
  });

  it("rejects an expired token with 410, even if never claimed", async () => {
    const { claimToken } = await createClaimableReceipt({
      claimTokenExpiresAt: new Date(Date.now() - 60_000),
    });
    const alice = await registerTestUser();

    const response = await callGet(claimToken, alice.token);
    expect(response.status).toBe(410);
  });

  it("rejects concurrent claims of the same token by two different users: exactly one winner, and ownership matches the winner", async () => {
    const { claimToken, receipt } = await createClaimableReceipt();
    const alice = await registerTestUser();
    const bob = await registerTestUser();

    const [aliceResponse, bobResponse] = await Promise.all([
      callGet(claimToken, alice.token),
      callGet(claimToken, bob.token),
    ]);
    const statuses = [aliceResponse.status, bobResponse.status].sort();
    expect(statuses).toEqual([200, 409]);

    const winnerId = aliceResponse.status === 200 ? alice.userId : bob.userId;
    const stored = await prisma.receipt.findUnique({ where: { id: receipt.id } });
    expect(stored?.ownerId).toBe(winnerId);
  });

  it("rejects a cross-origin request with 403 before touching token state", async () => {
    const { claimToken } = await createClaimableReceipt();
    const alice = await registerTestUser();

    const request = new NextRequest(`http://localhost/api/claim/${claimToken}`, {
      headers: { ...cookieHeader(alice.token), origin: "https://evil.example" },
    });
    const response = await GET(request, { params: Promise.resolve({ token: claimToken }) });
    expect(response.status).toBe(403);

    const followUp = await callGet(claimToken, alice.token);
    expect(followUp.status).toBe(200);
  });
});
