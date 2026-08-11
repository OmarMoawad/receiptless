import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { POST as receiptsPost } from "@/app/api/receipts/route";
import { cookieHeader, registerTestUser } from "@/test/auth-helpers";
import { GET } from "./route";

function searchRequest(sessionToken: string | undefined, q: string): NextRequest {
  return new NextRequest(`http://localhost/api/search?q=${encodeURIComponent(q)}`, {
    headers: cookieHeader(sessionToken),
  });
}

async function createReceipt(sessionToken: string, merchant: string) {
  await receiptsPost(
    new NextRequest("http://localhost/api/receipts", {
      method: "POST",
      body: JSON.stringify({
        merchant,
        currency: "USD",
        totalMinor: 500,
        purchasedAt: "2026-08-11T10:00:00Z",
      }),
      headers: { "content-type": "application/json", ...cookieHeader(sessionToken) },
    }),
  );
}

describe("GET /api/search", () => {
  it("rejects an unauthenticated request with 401", async () => {
    const response = await GET(searchRequest(undefined, "anything"));
    expect(response.status).toBe(401);
  });

  it("never surfaces another user's receipts in search results (tenant isolation #3)", async () => {
    const alice = await registerTestUser();
    const bob = await registerTestUser();
    const merchantName = `Shared Search Term ${randomUUID().slice(0, 8)}`;

    await createReceipt(bob.token, merchantName);

    const response = await GET(searchRequest(alice.token, merchantName));
    const body = await response.json();
    expect(body).toEqual([]);
  });
});
