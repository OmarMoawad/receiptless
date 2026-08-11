import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { GET as claimGet } from "@/app/api/claim/[token]/route";
import { POST as merchantPost } from "@/app/api/merchant/receipts/route";
import { cookieHeader, registerTestUser } from "@/test/auth-helpers";
import { GET, POST } from "./route";

function listRequest(sessionToken?: string, query = ""): NextRequest {
  return new NextRequest(`http://localhost/api/receipts${query}`, {
    headers: cookieHeader(sessionToken),
  });
}

function createRequest(sessionToken: string | undefined, body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/receipts", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", ...cookieHeader(sessionToken) },
  });
}

function validReceiptPayload(overrides: Record<string, unknown> = {}) {
  return {
    merchant: `Test Merchant ${randomUUID().slice(0, 8)}`,
    currency: "USD",
    totalMinor: 500,
    purchasedAt: "2026-08-11T10:00:00Z",
    ...overrides,
  };
}

describe("GET /api/receipts", () => {
  it("rejects an unauthenticated request with 401", async () => {
    const response = await GET(listRequest());
    expect(response.status).toBe(401);
  });

  it("lists only the caller's own receipts, never another user's (tenant isolation #1)", async () => {
    const alice = await registerTestUser();
    const bob = await registerTestUser();

    await POST(createRequest(alice.token, validReceiptPayload()));
    await POST(createRequest(bob.token, validReceiptPayload()));

    const aliceList = await (await GET(listRequest(alice.token))).json();
    expect(aliceList).toHaveLength(1);

    const bobList = await (await GET(listRequest(bob.token))).json();
    expect(bobList).toHaveLength(1);
    expect(aliceList[0].id).not.toBe(bobList[0].id);
  });

  it("cannot fetch another user's receipt by guessed id (tenant isolation #2)", async () => {
    const alice = await registerTestUser();
    const bob = await registerTestUser();

    const bobReceipt = await (await POST(createRequest(bob.token, validReceiptPayload()))).json();

    const response = await GET(listRequest(alice.token, `?id=${bobReceipt.id}`));
    const body = await response.json();
    expect(body).toEqual([]);
  });

  it("a merchant-created unclaimed receipt stays invisible until claimed (tenant isolation #9)", async () => {
    const alice = await registerTestUser();

    const merchantResponse = await merchantPost(
      new NextRequest("http://localhost/api/merchant/receipts", {
        method: "POST",
        body: JSON.stringify({
          merchant: `Unclaimed Merchant ${randomUUID().slice(0, 8)}`,
          currency: "USD",
          totalMinor: 700,
          purchasedAt: "2026-08-11T10:00:00Z",
          claimTtlMinutes: 30,
          source: "POS_API",
        }),
        headers: { "content-type": "application/json" },
      }),
    );
    const { receiptId, claimToken } = await merchantResponse.json();

    const beforeClaim = await (await GET(listRequest(alice.token))).json();
    expect(beforeClaim.find((r: { id: string }) => r.id === receiptId)).toBeUndefined();

    const claimResponse = await claimGet(
      new NextRequest(`http://localhost/api/claim/${claimToken}`, { headers: cookieHeader(alice.token) }),
      { params: Promise.resolve({ token: claimToken }) },
    );
    expect(claimResponse.status).toBe(200);

    const afterClaim = await (await GET(listRequest(alice.token))).json();
    expect(afterClaim.find((r: { id: string }) => r.id === receiptId)).toBeDefined();
  });
});

describe("POST /api/receipts", () => {
  it("rejects an unauthenticated request with 401", async () => {
    const response = await POST(createRequest(undefined, validReceiptPayload()));
    expect(response.status).toBe(401);
  });

  it("creates a receipt owned by the authenticated caller", async () => {
    const alice = await registerTestUser();
    const response = await POST(createRequest(alice.token, validReceiptPayload()));
    expect(response.status).toBe(201);
    const body = await response.json();

    const stored = await prisma.receipt.findUnique({ where: { id: body.id } });
    expect(stored?.ownerId).toBe(alice.userId);
  });
});
