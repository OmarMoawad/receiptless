import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { registerTestUser } from "@/test/auth-helpers";
import { recordManualRate } from "./rates";
import { captureConversion } from "./conversion-service";
import {
  applyFxReconciliation,
  previewFxReconciliation,
  StaleReportingCurrencyError,
  type ApplyFxReconciliationInput,
} from "./reconciliation-service";

const CORRELATION = `fx-reconciliation:${randomUUID()}` as ApplyFxReconciliationInput["correlationId"];

async function ownerReporting(currency: string) {
  const user = await registerTestUser();
  await prisma.user.update({ where: { id: user.userId }, data: { reportingCurrency: currency } });
  return user;
}

async function receiptFor(
  ownerId: string,
  options: { currency: string; totalMinor: number; purchasedAt: string },
) {
  const merchant = await prisma.merchant.create({ data: { name: `m_${randomUUID().slice(0, 8)}` } });
  return prisma.receipt.create({
    data: {
      ownerId,
      merchantId: merchant.id,
      currency: options.currency,
      totalMinor: options.totalMinor,
      purchasedAt: new Date(options.purchasedAt),
    },
  });
}

async function manualRate(ownerId: string, base: string, quote: string, date: string, rate: string) {
  await recordManualRate({
    ownerId,
    base,
    quote,
    effectiveDate: new Date(date),
    rate,
    actorUserId: ownerId,
  });
}

async function fxTableCounts(ownerId: string) {
  const [rates, conversions] = await Promise.all([
    prisma.fxRate.count({ where: { ownerId } }),
    prisma.receiptConversion.count({ where: { receipt: { ownerId } } }),
  ]);
  return { rates, conversions };
}

describe("previewFxReconciliation", () => {
  it("classifies each receipt and writes nothing", async () => {
    const owner = await ownerReporting("EGP");

    // same currency (EGP), already-current (USD converted to EGP),
    // old-target (EUR converted to USD, before the switch to EGP), and
    // missing (GBP, no conversion).
    await receiptFor(owner.userId, { currency: "EGP", totalMinor: 1000, purchasedAt: "2026-03-01T00:00:00Z" });

    await manualRate(owner.userId, "USD", "EGP", "2026-03-02T00:00:00Z", "49");
    const usd = await receiptFor(owner.userId, { currency: "USD", totalMinor: 1000, purchasedAt: "2026-03-02T00:00:00Z" });
    await captureConversion(usd.id);

    // A EUR receipt converted while reporting was still USD, so its target
    // is now stale.
    await prisma.user.update({ where: { id: owner.userId }, data: { reportingCurrency: "USD" } });
    await manualRate(owner.userId, "EUR", "USD", "2026-03-03T00:00:00Z", "1.08");
    const eur = await receiptFor(owner.userId, { currency: "EUR", totalMinor: 1000, purchasedAt: "2026-03-03T00:00:00Z" });
    await captureConversion(eur.id);
    await prisma.user.update({ where: { id: owner.userId }, data: { reportingCurrency: "EGP" } });

    await receiptFor(owner.userId, { currency: "GBP", totalMinor: 1000, purchasedAt: "2026-03-04T00:00:00Z" });

    const before = await fxTableCounts(owner.userId);
    const preview = await previewFxReconciliation(owner.userId);
    // Read-only: not a single row changed.
    expect(await fxTableCounts(owner.userId)).toEqual(before);

    expect(preview.reportingCurrency).toBe("EGP");
    expect(preview.total).toBe(4);
    expect(preview.categories).toEqual({
      sameCurrency: 1,
      alreadyCurrent: 1,
      missing: 1,
      oldTarget: 1,
    });
    expect(preview.eligible).toBe(2);
    expect(preview.bySourceCurrency.map((l) => l.sourceCurrency)).toEqual(["EGP", "EUR", "GBP", "USD"]);
  });

  it("never sees another owner's receipts", async () => {
    const alice = await ownerReporting("EGP");
    const bob = await ownerReporting("EGP");
    await receiptFor(bob.userId, { currency: "USD", totalMinor: 1000, purchasedAt: "2026-03-01T00:00:00Z" });

    expect((await previewFxReconciliation(alice.userId)).total).toBe(0);
  });
});

describe("applyFxReconciliation", () => {
  it("rejects a stale expected reporting currency before doing any work", async () => {
    const owner = await ownerReporting("EGP");
    await manualRate(owner.userId, "USD", "EGP", "2026-03-02T00:00:00Z", "49");
    const usd = await receiptFor(owner.userId, { currency: "USD", totalMinor: 1000, purchasedAt: "2026-03-02T00:00:00Z" });

    await expect(
      applyFxReconciliation(owner.userId, {
        limit: 10,
        expectedReportingCurrency: "USD", // owner reports in EGP
        correlationId: CORRELATION,
      }),
    ).rejects.toBeInstanceOf(StaleReportingCurrencyError);

    expect(await prisma.receiptConversion.count({ where: { receiptId: usd.id } })).toBe(0);
  });

  it("converts a missing receipt and records the run's provenance", async () => {
    const owner = await ownerReporting("EGP");
    await manualRate(owner.userId, "USD", "EGP", "2026-03-02T00:00:00Z", "49");
    const usd = await receiptFor(owner.userId, { currency: "USD", totalMinor: 1000, purchasedAt: "2026-03-02T00:00:00Z" });

    const result = await applyFxReconciliation(owner.userId, {
      limit: 10,
      expectedReportingCurrency: "EGP",
      correlationId: CORRELATION,
    });

    expect(result.processed).toBe(1);
    expect(result.results.converted).toBe(1);
    expect(result.nextCursor).toBeNull();

    const row = await prisma.receiptConversion.findFirstOrThrow({ where: { receiptId: usd.id } });
    expect(row.approved).toBe(true);
    expect(row.targetCurrency).toBe("EGP");
    expect(row.operator).toBe(owner.userId);
    expect(row.reason).toBe("owner-requested FX reconciliation");
    expect(row.correlationId).toBe(CORRELATION);
  });

  it("reprocesses an old-target conversion into the current currency", async () => {
    const owner = await ownerReporting("USD");
    await manualRate(owner.userId, "EUR", "USD", "2026-03-03T00:00:00Z", "1.08");
    const eur = await receiptFor(owner.userId, { currency: "EUR", totalMinor: 1000, purchasedAt: "2026-03-03T00:00:00Z" });
    await captureConversion(eur.id);

    // Switch to EGP and supply a EUR->EGP rate to reprocess with.
    await prisma.user.update({ where: { id: owner.userId }, data: { reportingCurrency: "EGP" } });
    await manualRate(owner.userId, "EUR", "EGP", "2026-03-03T00:00:00Z", "53");

    const result = await applyFxReconciliation(owner.userId, {
      limit: 10,
      expectedReportingCurrency: "EGP",
      correlationId: CORRELATION,
    });

    expect(result.results.reprocessed).toBe(1);
    const approved = await prisma.receiptConversion.findFirstOrThrow({
      where: { receiptId: eur.id, approved: true },
    });
    expect(approved.targetCurrency).toBe("EGP");
    // The prior USD version is retained, unapproved.
    expect(await prisma.receiptConversion.count({ where: { receiptId: eur.id } })).toBe(2);
  });

  it("counts a rate-less receipt as unavailable, not failed, and leaves it untouched", async () => {
    const owner = await ownerReporting("EGP");
    const usd = await receiptFor(owner.userId, { currency: "USD", totalMinor: 1000, purchasedAt: "2026-03-02T00:00:00Z" });

    const result = await applyFxReconciliation(owner.userId, {
      limit: 10,
      expectedReportingCurrency: "EGP",
      correlationId: CORRELATION,
    });

    expect(result.results.unavailable).toBe(1);
    expect(result.results.failed).toBe(0);
    expect(await prisma.receiptConversion.count({ where: { receiptId: usd.id } })).toBe(0);
  });

  it("caps a batch at ten and hands back a cursor to resume", async () => {
    const owner = await ownerReporting("EGP");
    await manualRate(owner.userId, "USD", "EGP", "2026-03-01T00:00:00Z", "49");
    // 12 USD receipts on distinct days.
    for (let day = 1; day <= 12; day++) {
      await manualRate(owner.userId, "USD", "EGP", `2026-03-${String(day).padStart(2, "0")}T00:00:00Z`, "49");
      await receiptFor(owner.userId, {
        currency: "USD",
        totalMinor: 1000,
        purchasedAt: `2026-03-${String(day).padStart(2, "0")}T00:00:00Z`,
      });
    }

    const first = await applyFxReconciliation(owner.userId, {
      limit: 10,
      expectedReportingCurrency: "EGP",
      correlationId: CORRELATION,
    });
    expect(first.processed).toBe(10);
    expect(first.nextCursor).not.toBeNull();

    const second = await applyFxReconciliation(owner.userId, {
      limit: 10,
      expectedReportingCurrency: "EGP",
      correlationId: CORRELATION,
      cursor: first.nextCursor ?? undefined,
    });
    expect(second.processed).toBe(2);
    expect(second.nextCursor).toBeNull();

    // Every receipt converted exactly once, none processed twice.
    expect(
      await prisma.receiptConversion.count({ where: { receipt: { ownerId: owner.userId }, approved: true } }),
    ).toBe(12);
  });

  it("never touches another owner's receipts", async () => {
    const alice = await ownerReporting("EGP");
    const bob = await ownerReporting("EGP");
    await manualRate(bob.userId, "USD", "EGP", "2026-03-02T00:00:00Z", "49");
    const bobReceipt = await receiptFor(bob.userId, { currency: "USD", totalMinor: 1000, purchasedAt: "2026-03-02T00:00:00Z" });

    const result = await applyFxReconciliation(alice.userId, {
      limit: 10,
      expectedReportingCurrency: "EGP",
      correlationId: CORRELATION,
    });

    expect(result.processed).toBe(0);
    expect(await prisma.receiptConversion.count({ where: { receiptId: bobReceipt.id } })).toBe(0);
  });
});
