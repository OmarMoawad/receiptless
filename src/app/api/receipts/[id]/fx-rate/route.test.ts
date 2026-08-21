import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { cookieHeader, registerTestUser } from "@/test/auth-helpers";
import { POST } from "./route";

async function receiptIn(currency: string, ownerId: string, purchasedAt = "2026-03-02T10:00:00.000Z") {
  const merchant = await prisma.merchant.create({ data: { name: `m_${Math.random().toString(36).slice(2)}` } });
  return prisma.receipt.create({
    data: {
      ownerId,
      merchantId: merchant.id,
      currency,
      totalMinor: 500_00,
      purchasedAt: new Date(purchasedAt),
    },
  });
}

const post = (id: string, body: unknown, token?: string) =>
  POST(
    new NextRequest(`http://localhost/api/receipts/${id}/fx-rate`, {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json", ...cookieHeader(token) },
    }),
    { params: Promise.resolve({ id }) },
  );

describe("POST /api/receipts/[id]/fx-rate", () => {
  it("rejects an unauthenticated caller", async () => {
    const owner = await registerTestUser();
    const receipt = await receiptIn("EGP", owner.userId);
    expect((await post(receipt.id, { rate: "0.0207" })).status).toBe(401);
  });

  it("hides another owner's receipt behind the same 404 as a missing one", async () => {
    const owner = await registerTestUser();
    const stranger = await registerTestUser();
    const receipt = await receiptIn("EGP", owner.userId);

    expect((await post(receipt.id, { rate: "0.0207" }, stranger.token)).status).toBe(404);
  });

  it("stores the rate and converts the receipt", async () => {
    const owner = await registerTestUser();
    const receipt = await receiptIn("EGP", owner.userId);

    const response = await post(receipt.id, { rate: "0.0207" }, owner.token);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.status).toBe("converted");
    // 500.00 EGP × 0.0207 = 10.35 USD
    expect(body.snapshot.totalTargetMinor).toBe(1035);
  });

  it("treats a second entry as a correction, keeping the first version", async () => {
    const owner = await registerTestUser();
    const receipt = await receiptIn("EGP", owner.userId);

    await post(receipt.id, { rate: "0.0207" }, owner.token);
    const second = await post(receipt.id, { rate: "0.025", reason: "the bank's actual rate" }, owner.token);

    const body = await second.json();
    expect(body.snapshot.version).toBe(2);
    expect(body.snapshot.totalTargetMinor).toBe(1250);

    const versions = await prisma.receiptConversion.findMany({
      where: { receiptId: receipt.id },
      orderBy: { version: "asc" },
    });
    // The figure someone may already have filed on is still there.
    expect(versions).toHaveLength(2);
    expect(versions[0].totalTargetMinor).toBe(1035);
    expect(versions[0].approved).toBe(false);
    expect(versions[1].reason).toBe("the bank's actual rate");
  });

  it("rejects a rate that is not canonical, rather than coercing it", async () => {
    const owner = await registerTestUser();
    const receipt = await receiptIn("EGP", owner.userId);

    // Trailing fractional zeros: the same value, spelled a second way.
    const response = await post(receipt.id, { rate: "0.02070" }, owner.token);
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/canonical/);
  });

  it("rejects a non-positive rate", async () => {
    const owner = await registerTestUser();
    const receipt = await receiptIn("EGP", owner.userId);

    for (const rate of ["0", "-1.5"]) {
      expect((await post(receipt.id, { rate }, owner.token)).status).toBe(400);
    }
  });

  it("refuses a receipt already in the reporting currency", async () => {
    const owner = await registerTestUser();
    const receipt = await receiptIn("USD", owner.userId);

    const response = await post(receipt.id, { rate: "1.5" }, owner.token);
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/already in USD/);
  });

  it("does not let one owner's rate reach another owner's receipts", async () => {
    const alice = await registerTestUser();
    const bob = await registerTestUser();
    const aliceReceipt = await receiptIn("EGP", alice.userId);
    const bobReceipt = await receiptIn("EGP", bob.userId);

    await post(aliceReceipt.id, { rate: "0.0207" }, alice.token);

    // Bob's receipt is on the same day and the same pair, and is still
    // unconverted: a manual rate is tenant-owned, never a global override.
    expect(await prisma.receiptConversion.count({ where: { receiptId: bobReceipt.id } })).toBe(0);
  });
});
