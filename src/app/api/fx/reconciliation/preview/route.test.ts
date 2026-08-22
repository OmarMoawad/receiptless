import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { cookieHeader, registerTestUser } from "@/test/auth-helpers";
import { POST } from "./route";

async function reportingIn(currency: string) {
  const user = await registerTestUser();
  await prisma.user.update({ where: { id: user.userId }, data: { reportingCurrency: currency } });
  return user;
}

async function receiptFor(ownerId: string, currency: string) {
  const merchant = await prisma.merchant.create({ data: { name: `m_${Math.random().toString(36).slice(2)}` } });
  return prisma.receipt.create({
    data: { ownerId, merchantId: merchant.id, currency, totalMinor: 1000, purchasedAt: new Date("2026-03-02T00:00:00Z") },
  });
}

const post = (token?: string) =>
  POST(
    new NextRequest("http://localhost/api/fx/reconciliation/preview", {
      method: "POST",
      headers: { "content-type": "application/json", ...cookieHeader(token) },
    }),
  );

describe("POST /api/fx/reconciliation/preview", () => {
  it("rejects an unauthenticated caller", async () => {
    expect((await post()).status).toBe(401);
  });

  it("returns owner-scoped counts", async () => {
    const owner = await reportingIn("EGP");
    await receiptFor(owner.userId, "EGP"); // same currency
    await receiptFor(owner.userId, "USD"); // missing

    const response = await post(owner.token);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.reportingCurrency).toBe("EGP");
    expect(body.total).toBe(2);
    expect(body.categories).toMatchObject({ sameCurrency: 1, missing: 1 });
    expect(body.eligible).toBe(1);
  });
});
