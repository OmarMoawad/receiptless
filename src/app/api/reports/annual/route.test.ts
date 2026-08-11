import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { POST as receiptsPost } from "@/app/api/receipts/route";
import { cookieHeader, registerTestUser } from "@/test/auth-helpers";
import { GET } from "./route";

async function createReceipt(sessionToken: string, purchasedAt: string) {
  await receiptsPost(
    new NextRequest("http://localhost/api/receipts", {
      method: "POST",
      body: JSON.stringify({
        merchant: "Annual Report Test Merchant",
        currency: "USD",
        totalMinor: 5_000,
        purchasedAt,
      }),
      headers: { "content-type": "application/json", ...cookieHeader(sessionToken) },
    }),
  );
}

function reportRequest(sessionToken?: string): NextRequest {
  return new NextRequest("http://localhost/api/reports/annual", {
    headers: cookieHeader(sessionToken),
  });
}

describe("GET /api/reports/annual", () => {
  it("rejects an unauthenticated request with 401", async () => {
    const response = await GET(reportRequest());
    expect(response.status).toBe(401);
  });

  it("never aggregates another user's data into the caller's report (tenant isolation #4)", async () => {
    const alice = await registerTestUser();
    const bob = await registerTestUser();

    // A distinctive, unlikely-to-collide year so this assertion isn't
    // sensitive to other tests' fixture data landing in the same bucket.
    await createReceipt(bob.token, "2071-06-01T10:00:00Z");

    const response = await GET(reportRequest(alice.token));
    const body = await response.json();
    expect(body.years.find((y: { year: number }) => y.year === 2071)).toBeUndefined();
  });
});
