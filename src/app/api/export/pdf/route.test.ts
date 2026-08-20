import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { cookieHeader, registerTestUser } from "@/test/auth-helpers";
import { GET } from "./route";

function exportRequest(sessionToken?: string): NextRequest {
  return new NextRequest("http://localhost/api/export/pdf", {
    headers: cookieHeader(sessionToken),
  });
}

async function seedReceipt(ownerId: string, merchantName: string) {
  const merchant = await prisma.merchant.create({ data: { name: merchantName } });
  return prisma.receipt.create({
    data: {
      ownerId,
      merchantId: merchant.id,
      currency: "USD",
      totalMinor: 1299,
      purchasedAt: new Date("2026-08-20T12:00:00.000Z"),
      notes: "Archive note",
      items: {
        create: {
          name: "Coffee beans",
          quantity: 1,
          unitPriceMinor: 1299,
          totalPriceMinor: 1299,
          warrantyMonths: 12,
          returnWindowDays: 30,
        },
      },
    },
  });
}

describe("GET /api/export/pdf", () => {
  it("rejects an unauthenticated export", async () => {
    const response = await GET(exportRequest());
    expect(response.status).toBe(401);
  });

  it("streams a valid PDF archive for an authenticated owner", async () => {
    const owner = await registerTestUser();
    const stranger = await registerTestUser();
    const suffix = randomUUID().slice(0, 8);
    await seedReceipt(owner.userId, `Owned Archive ${suffix}`);
    await seedReceipt(stranger.userId, `Private Archive ${suffix}`);

    const response = await GET(exportRequest(owner.token));
    const bytes = new Uint8Array(await response.arrayBuffer());
    const trailer = new TextDecoder().decode(bytes.slice(-32));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toContain("receiptless-archive-");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    expect(trailer).toContain("%%EOF");
    expect(bytes.byteLength).toBeGreaterThan(1_000);
  });
});
