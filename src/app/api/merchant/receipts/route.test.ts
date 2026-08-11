import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { POST } from "./route";

function uniqueMerchantName(): string {
  return `Test Merchant ${randomUUID().slice(0, 8)}`;
}

function postRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/merchant/receipts", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

function validPayload(overrides: Record<string, unknown> = {}) {
  return {
    merchant: uniqueMerchantName(),
    currency: "USD",
    totalMinor: 1250,
    purchasedAt: "2026-08-11T10:00:00Z",
    claimTtlMinutes: 30,
    source: "POS_API",
    ...overrides,
  };
}

describe("POST /api/merchant/receipts", () => {
  it("creates a receipt and issues a claim token", async () => {
    const response = await POST(postRequest(validPayload()));
    expect(response.status).toBe(201);

    const body = await response.json();
    expect(typeof body.receiptId).toBe("string");
    expect(typeof body.claimToken).toBe("string");
    expect(body.claimUrlWeb).toContain(body.claimToken);

    const receipt = await prisma.receipt.findUnique({ where: { id: body.receiptId } });
    expect(receipt?.verification).toBe("UNVERIFIED");
    expect(receipt?.claimedAt).toBeNull();
  });

  it("rejects invalid JSON with 400", async () => {
    const response = await POST(postRequest("not json"));
    expect(response.status).toBe(400);
  });

  it("rejects a payload missing required fields with 400 and issue details", async () => {
    const response = await POST(postRequest({ currency: "USD" }));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(Array.isArray(body.issues)).toBe(true);
  });

  it("rejects a non-integer totalMinor (no float currency amounts)", async () => {
    const response = await POST(postRequest(validPayload({ totalMinor: 12.5 })));
    expect(response.status).toBe(400);
  });

  it("does not overwrite an existing merchant's website from a later call", async () => {
    // Regression test: this endpoint is unauthenticated (see route.ts's doc
    // comment), so it must never let arbitrary input mutate canonical
    // merchant data for a merchant that already exists.
    const merchant = uniqueMerchantName();
    await POST(postRequest(validPayload({ merchant, merchantWebsite: "https://original.example" })));
    await POST(postRequest(validPayload({ merchant, merchantWebsite: "https://malicious.example" })));

    const stored = await prisma.merchant.findUnique({ where: { name: merchant } });
    expect(stored?.website).toBe("https://original.example");
  });

  it("sets the website when creating a brand-new merchant", async () => {
    const merchant = uniqueMerchantName();
    await POST(postRequest(validPayload({ merchant, merchantWebsite: "https://real.example" })));

    const stored = await prisma.merchant.findUnique({ where: { name: merchant } });
    expect(stored?.website).toBe("https://real.example");
  });
});
