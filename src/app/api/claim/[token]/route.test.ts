import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { GET } from "./route";

async function createClaimableReceipt(overrides: {
  claimTokenExpiresAt?: Date;
  claimedAt?: Date | null;
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
    },
  });
  return { receipt, claimToken };
}

function callGet(token: string) {
  const request = new NextRequest(`http://localhost/api/claim/${token}`);
  return GET(request, { params: Promise.resolve({ token }) });
}

describe("GET /api/claim/[token]", () => {
  it("resolves an unclaimed, unexpired token and marks it claimed", async () => {
    const { claimToken, receipt } = await createClaimableReceipt();

    const response = await callGet(claimToken);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.id).toBe(receipt.id);
    expect(body.claimedAt).not.toBeNull();
  });

  it("rejects a second resolution of the same token with 409 (single-use)", async () => {
    const { claimToken } = await createClaimableReceipt();

    const first = await callGet(claimToken);
    expect(first.status).toBe(200);

    const second = await callGet(claimToken);
    expect(second.status).toBe(409);
  });

  it("rejects an unknown token with 404", async () => {
    const response = await callGet(randomUUID());
    expect(response.status).toBe(404);
  });

  it("rejects an expired token with 410, even if never claimed", async () => {
    const { claimToken } = await createClaimableReceipt({
      claimTokenExpiresAt: new Date(Date.now() - 60_000),
    });

    const response = await callGet(claimToken);
    expect(response.status).toBe(410);
  });

  it("rejects concurrent claims of the same token: only one wins", async () => {
    const { claimToken } = await createClaimableReceipt();

    const [first, second] = await Promise.all([callGet(claimToken), callGet(claimToken)]);
    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([200, 409]);
  });
});
