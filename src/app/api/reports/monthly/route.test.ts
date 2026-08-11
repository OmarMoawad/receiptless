import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { POST as receiptsPost } from "@/app/api/receipts/route";
import { cookieHeader, registerTestUser } from "@/test/auth-helpers";
import { GET } from "./route";

async function createReceipt(sessionToken: string, totalMinor: number) {
  await receiptsPost(
    new NextRequest("http://localhost/api/receipts", {
      method: "POST",
      body: JSON.stringify({
        merchant: "Report Test Merchant",
        currency: "USD",
        totalMinor,
        purchasedAt: "2026-03-15T10:00:00Z",
      }),
      headers: { "content-type": "application/json", ...cookieHeader(sessionToken) },
    }),
  );
}

function reportRequest(sessionToken: string | undefined, year: number): NextRequest {
  return new NextRequest(`http://localhost/api/reports/monthly?year=${year}`, {
    headers: cookieHeader(sessionToken),
  });
}

describe("GET /api/reports/monthly", () => {
  it("rejects an unauthenticated request with 401", async () => {
    const response = await GET(reportRequest(undefined, 2026));
    expect(response.status).toBe(401);
  });

  it("never aggregates another user's data into the caller's report (tenant isolation #4)", async () => {
    const alice = await registerTestUser();
    const bob = await registerTestUser();

    await createReceipt(bob.token, 10_000);

    const response = await GET(reportRequest(alice.token, 2026));
    const body = await response.json();
    expect(body.months[2].total).toBe(0);
    expect(body.months[2].count).toBe(0);
  });
});
