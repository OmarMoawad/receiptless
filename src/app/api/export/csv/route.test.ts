import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { cookieHeader, registerTestUser } from "@/test/auth-helpers";
import { GET } from "./route";

function exportRequest(sessionToken?: string): NextRequest {
  return new NextRequest("http://localhost/api/export/csv", {
    headers: cookieHeader(sessionToken),
  });
}

async function createReceipt(
  ownerId: string,
  options: {
    merchant: string;
    notes?: string;
    items?: Array<{
      name: string;
      quantity: number;
      unitPriceMinor: number;
      totalPriceMinor: number;
    }>;
  },
) {
  const merchant = await prisma.merchant.create({ data: { name: options.merchant } });
  return prisma.receipt.create({
    data: {
      ownerId,
      merchantId: merchant.id,
      currency: "USD",
      totalMinor: 1234,
      purchasedAt: new Date("2026-08-20T12:00:00.000Z"),
      notes: options.notes,
      items: options.items ? { create: options.items } : undefined,
    },
  });
}

describe("GET /api/export/csv", () => {
  it("rejects an unauthenticated export", async () => {
    const response = await GET(exportRequest());
    expect(response.status).toBe(401);
  });

  it("exports one spreadsheet-safe row per owned item and one row for an itemless receipt", async () => {
    const owner = await registerTestUser();
    const stranger = await registerTestUser();
    const suffix = randomUUID().slice(0, 8);

    await createReceipt(owner.userId, {
      merchant: `Cafe, ${suffix}`,
      notes: "Line one\nLine two",
      items: [
        { name: "=2+2", quantity: 2, unitPriceMinor: 300, totalPriceMinor: 600 },
        { name: "Tea", quantity: 1, unitPriceMinor: 634, totalPriceMinor: 634 },
      ],
    });
    await createReceipt(owner.userId, { merchant: `Itemless ${suffix}` });
    await createReceipt(stranger.userId, { merchant: `Private ${suffix}` });

    const response = await GET(exportRequest(owner.token));
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/csv");
    expect(response.headers.get("content-disposition")).toContain("receiptless-receipts-");
    expect(body).toContain("receipt_id,purchased_at,merchant,currency,total_minor");
    expect(body).toContain(`"Cafe, ${suffix}"`);
    expect(body).toContain("'" + "=2+2");
    expect(body).toContain('"Line one\nLine two"');
    expect(body).toContain(`Itemless ${suffix}`);
    expect(body).not.toContain(`Private ${suffix}`);
    expect(body.trim().split("\r\n")).toHaveLength(4);
  });
});
