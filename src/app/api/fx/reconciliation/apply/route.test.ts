import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { recordManualRate } from "@/lib/fx/rates";
import { cookieHeader, registerTestUser } from "@/test/auth-helpers";
import { POST } from "./route";

async function reportingIn(currency: string) {
  const user = await registerTestUser();
  await prisma.user.update({ where: { id: user.userId }, data: { reportingCurrency: currency } });
  return user;
}

async function usdReceiptWithRate(ownerId: string) {
  await recordManualRate({
    ownerId,
    base: "USD",
    quote: "EGP",
    effectiveDate: new Date("2026-03-02T00:00:00Z"),
    rate: "49",
    actorUserId: ownerId,
  });
  const merchant = await prisma.merchant.create({ data: { name: `m_${randomUUID().slice(0, 8)}` } });
  return prisma.receipt.create({
    data: { ownerId, merchantId: merchant.id, currency: "USD", totalMinor: 1000, purchasedAt: new Date("2026-03-02T00:00:00Z") },
  });
}

const correlationId = `fx-reconciliation:${randomUUID()}`;

const post = (body: unknown, token?: string) =>
  POST(
    new NextRequest("http://localhost/api/fx/reconciliation/apply", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json", ...cookieHeader(token) },
    }),
  );

describe("POST /api/fx/reconciliation/apply", () => {
  it("rejects an unauthenticated caller", async () => {
    const response = await post({ limit: 10, expectedReportingCurrency: "EGP", correlationId });
    expect(response.status).toBe(401);
  });

  it("rejects a limit above ten", async () => {
    const owner = await reportingIn("EGP");
    const response = await post({ limit: 11, expectedReportingCurrency: "EGP", correlationId }, owner.token);
    expect(response.status).toBe(400);
  });

  it("rejects a malformed correlation id", async () => {
    const owner = await reportingIn("EGP");
    const response = await post(
      { limit: 10, expectedReportingCurrency: "EGP", correlationId: "not-a-run" },
      owner.token,
    );
    expect(response.status).toBe(400);
  });

  it("refuses a stale expected reporting currency with 409", async () => {
    const owner = await reportingIn("EGP");
    await usdReceiptWithRate(owner.userId);
    const response = await post(
      { limit: 10, expectedReportingCurrency: "USD", correlationId },
      owner.token,
    );
    expect(response.status).toBe(409);
  });

  it("applies a batch for the authenticated owner", async () => {
    const owner = await reportingIn("EGP");
    const receipt = await usdReceiptWithRate(owner.userId);

    const response = await post({ limit: 10, expectedReportingCurrency: "EGP", correlationId }, owner.token);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.processed).toBe(1);
    expect(body.results.converted).toBe(1);
    expect(await prisma.receiptConversion.count({ where: { receiptId: receipt.id, approved: true } })).toBe(1);
  });
});
