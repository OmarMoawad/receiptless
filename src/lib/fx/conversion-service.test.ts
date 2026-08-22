import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { registerTestUser } from "@/test/auth-helpers";
import { MAX_RATE_LOOKBACK_DAYS, recordManualRate, resolveRate } from "./rates";
import { approvedConversion, captureConversion, reprocessConversion } from "./conversion-service";

async function ownerWithReportingCurrency(currency: string) {
  const user = await registerTestUser();
  await prisma.user.update({ where: { id: user.userId }, data: { reportingCurrency: currency } });
  return user;
}

async function receiptFor(
  ownerId: string,
  options: { currency: string; totalMinor: number; purchasedAt: string },
) {
  const merchant = await prisma.merchant.create({ data: { name: `m_${Math.random().toString(36).slice(2)}` } });
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

describe("manual rates", () => {
  it("rejects a non-canonical rate before writing anything", async () => {
    const user = await ownerWithReportingCurrency("USD");
    await expect(
      recordManualRate({
        ownerId: user.userId,
        base: "EGP",
        quote: "USD",
        effectiveDate: new Date("2026-03-01T00:00:00Z"),
        rate: "0.0207000",
        actorUserId: user.userId,
      }),
    ).rejects.toThrow(/canonical/);

    expect(await prisma.fxRate.count({ where: { ownerId: user.userId } })).toBe(0);
  });

  it("supersedes rather than updates, so the old belief survives the correction", async () => {
    const user = await ownerWithReportingCurrency("USD");
    const date = new Date("2026-03-01T00:00:00Z");

    const first = await recordManualRate({
      ownerId: user.userId,
      base: "EGP",
      quote: "USD",
      effectiveDate: date,
      rate: "0.0207",
      actorUserId: user.userId,
    });
    const second = await recordManualRate({
      ownerId: user.userId,
      base: "EGP",
      quote: "USD",
      effectiveDate: date,
      rate: "0.0205",
      actorUserId: user.userId,
      reason: "matched the figure on the card statement",
    });

    expect(second.supersededId).toBe(first.id);

    const rows = await prisma.fxRate.findMany({ where: { ownerId: user.userId }, orderBy: { createdAt: "asc" } });
    expect(rows).toHaveLength(2);
    expect(rows[0].supersededAt).not.toBeNull();
    expect(rows[1].supersededAt).toBeNull();
    expect(rows[1].reason).toBe("matched the figure on the card statement");
  });

  it("keeps one owner's rate out of another's resolution", async () => {
    const alice = await ownerWithReportingCurrency("USD");
    const bob = await ownerWithReportingCurrency("USD");
    const on = new Date("2026-03-01T00:00:00Z");

    await recordManualRate({
      ownerId: alice.userId,
      base: "EGP",
      quote: "USD",
      effectiveDate: on,
      rate: "0.0207",
      actorUserId: alice.userId,
    });

    expect(await resolveRate({ ownerId: alice.userId, base: "EGP", quote: "USD", on })).not.toBeNull();
    // A manual rate is tenant-owned, not a global override.
    expect(await resolveRate({ ownerId: bob.userId, base: "EGP", quote: "USD", on })).toBeNull();
  });
});

describe("resolving which rate applies", () => {
  it("reaches back over a weekend, and says that it did", async () => {
    const user = await ownerWithReportingCurrency("USD");
    await recordManualRate({
      ownerId: user.userId,
      base: "GBP",
      quote: "USD",
      effectiveDate: new Date("2026-03-06T00:00:00Z"),
      rate: "1.27",
      actorUserId: user.userId,
    });

    const resolved = await resolveRate({
      ownerId: user.userId,
      base: "GBP",
      quote: "USD",
      on: new Date("2026-03-08T00:00:00Z"),
    });

    expect(resolved?.rate).toBe("1.27");
    // Visible as a reach-back rather than passing for an exact-day match.
    expect(resolved?.reachedBack).toBe(true);
    expect(resolved?.effectiveDate.toISOString().slice(0, 10)).toBe("2026-03-06");
  });

  it("refuses to reach back further than the lookback window", async () => {
    const user = await ownerWithReportingCurrency("USD");
    const rateDay = new Date("2026-03-01T00:00:00Z");
    await recordManualRate({
      ownerId: user.userId,
      base: "GBP",
      quote: "USD",
      effectiveDate: rateDay,
      rate: "1.27",
      actorUserId: user.userId,
    });

    const tooLate = new Date(rateDay.getTime() + (MAX_RATE_LOOKBACK_DAYS + 1) * 24 * 60 * 60 * 1000);
    expect(await resolveRate({ ownerId: user.userId, base: "GBP", quote: "USD", on: tooLate })).toBeNull();
  });

  it("never reaches forward to a rate published after the purchase", async () => {
    const user = await ownerWithReportingCurrency("USD");
    await recordManualRate({
      ownerId: user.userId,
      base: "GBP",
      quote: "USD",
      effectiveDate: new Date("2026-03-10T00:00:00Z"),
      rate: "1.27",
      actorUserId: user.userId,
    });

    // Converting a purchase with a rate from after it happened is exactly
    // the "convert on read with today's rate" failure this session exists
    // to prevent.
    const resolved = await resolveRate({
      ownerId: user.userId,
      base: "GBP",
      quote: "USD",
      on: new Date("2026-03-05T00:00:00Z"),
    });
    expect(resolved).toBeNull();
  });

  /**
   * There is deliberately no test that reaches `AmbiguousRateError`.
   *
   * Writing one showed it is **unreachable while the partial unique
   * indexes exist**, which is the stronger result: the manual index keys
   * on (owner, base, quote, date) and ignores `source`, so a second
   * active row cannot be inserted under any source name, and the provider
   * lookup filters to the one configured source. The error stays as
   * defence in depth for the case where a later migration drops an index
   * — precisely the failure that would otherwise turn "the active rate"
   * back into "whichever row came back first". The test below is what
   * actually holds the property today.
   */
  it("cannot store two active manual rates for the same key", async () => {
    const user = await ownerWithReportingCurrency("USD");
    const effectiveDate = new Date("2026-03-01T00:00:00Z");
    const row = {
      ownerId: user.userId,
      base: "EGP",
      quote: "USD",
      effectiveDate,
      source: "manual",
      sourcePolicyVersion: "manual-entry@1",
    };

    await prisma.fxRate.create({ data: { ...row, rate: "0.0207" } });
    // The partial unique index, doing its job.
    await expect(prisma.fxRate.create({ data: { ...row, rate: "0.0205" } })).rejects.toThrow();
  });
});

describe("capturing a conversion onto a receipt", () => {
  it("does nothing when the receipt is already in the reporting currency", async () => {
    const user = await ownerWithReportingCurrency("USD");
    const receipt = await receiptFor(user.userId, {
      currency: "USD",
      totalMinor: 1000,
      purchasedAt: "2026-03-02T10:00:00Z",
    });

    expect(await captureConversion(receipt.id)).toEqual({ status: "same-currency", currency: "USD" });
    expect(await prisma.receiptConversion.count({ where: { receiptId: receipt.id } })).toBe(0);
  });

  it("reports unavailable, with a reason, when no rate is on file", async () => {
    const user = await ownerWithReportingCurrency("USD");
    const receipt = await receiptFor(user.userId, {
      currency: "EGP",
      totalMinor: 100_00,
      purchasedAt: "2026-03-02T10:00:00Z",
    });

    const state = await captureConversion(receipt.id);
    expect(state.status).toBe("unavailable");
    // Step 3: say the number is not known rather than substitute one.
    if (state.status === "unavailable") {
      expect(state.reason).toMatch(/No EGP\/USD rate is on file for 2026-03-02/);
    }
    expect(await approvedConversion(receipt.id)).toBeNull();
  });

  it("stores a snapshot that reproduces without the rate table", async () => {
    const user = await ownerWithReportingCurrency("USD");
    await recordManualRate({
      ownerId: user.userId,
      base: "EGP",
      quote: "USD",
      effectiveDate: new Date("2026-03-02T00:00:00Z"),
      rate: "0.0207",
      actorUserId: user.userId,
    });
    const receipt = await receiptFor(user.userId, {
      currency: "EGP",
      totalMinor: 500_00,
      purchasedAt: "2026-03-02T10:00:00Z",
    });

    const state = await captureConversion(receipt.id);
    expect(state.status).toBe("converted");

    const row = await prisma.receiptConversion.findFirstOrThrow({ where: { receiptId: receipt.id } });
    // 500.00 EGP × 0.0207 = 10.35 USD
    expect(row.totalTargetMinor).toBe(1035);
    expect(row.rate).toBe("0.0207");
    expect(row.sourceScale).toBe(2);
    expect(row.targetScale).toBe(2);
    expect(row.currencyMetadataVersion).toBeTruthy();
    expect(row.conversionPolicyVersion).toBeTruthy();
    expect(row.ratePolicyVersion).toContain("fx-resolver@1");
    expect(row.unroundedResult).toBe("10.35");
  });

  it("is idempotent, so every ingestion path can call it", async () => {
    const user = await ownerWithReportingCurrency("USD");
    await recordManualRate({
      ownerId: user.userId,
      base: "EGP",
      quote: "USD",
      effectiveDate: new Date("2026-03-02T00:00:00Z"),
      rate: "0.0207",
      actorUserId: user.userId,
    });
    const receipt = await receiptFor(user.userId, {
      currency: "EGP",
      totalMinor: 500_00,
      purchasedAt: "2026-03-02T10:00:00Z",
    });

    await captureConversion(receipt.id);
    await captureConversion(receipt.id);
    await captureConversion(receipt.id);

    expect(await prisma.receiptConversion.count({ where: { receiptId: receipt.id } })).toBe(1);
  });

  it("does not move a stored conversion when the rate is later corrected", async () => {
    const user = await ownerWithReportingCurrency("USD");
    const effectiveDate = new Date("2026-03-02T00:00:00Z");
    await recordManualRate({
      ownerId: user.userId,
      base: "EGP",
      quote: "USD",
      effectiveDate,
      rate: "0.0207",
      actorUserId: user.userId,
    });
    const receipt = await receiptFor(user.userId, {
      currency: "EGP",
      totalMinor: 500_00,
      purchasedAt: "2026-03-02T10:00:00Z",
    });
    await captureConversion(receipt.id);

    // The correction that would silently rewrite history in a design that
    // looked the rate up on read.
    await recordManualRate({
      ownerId: user.userId,
      base: "EGP",
      quote: "USD",
      effectiveDate,
      rate: "0.01",
      actorUserId: user.userId,
      reason: "the bank's actual rate",
    });

    const unchanged = await approvedConversion(receipt.id);
    expect(unchanged?.totalTargetMinor).toBe(1035);
    expect(await captureConversion(receipt.id)).toMatchObject({ status: "converted" });
    expect((await approvedConversion(receipt.id))?.totalTargetMinor).toBe(1035);
  });
});

describe("concurrent capture and audit context", () => {
  async function ownerRateReceipt() {
    const user = await ownerWithReportingCurrency("USD");
    await recordManualRate({
      ownerId: user.userId,
      base: "EGP",
      quote: "USD",
      effectiveDate: new Date("2026-03-02T00:00:00Z"),
      rate: "0.0207",
      actorUserId: user.userId,
    });
    const receipt = await receiptFor(user.userId, {
      currency: "EGP",
      totalMinor: 500_00,
      purchasedAt: "2026-03-02T10:00:00Z",
    });
    return { user, receipt };
  }

  it("resolves two concurrent initial captures to a single approved snapshot", async () => {
    const { receipt } = await ownerRateReceipt();

    // The race every ingestion path can trigger: the mailbox scan and the
    // receipt page both capturing at once. Exactly one row may result.
    const [left, right] = await Promise.all([
      captureConversion(receipt.id),
      captureConversion(receipt.id),
    ]);

    expect(left.status).toBe("converted");
    expect(right.status).toBe("converted");
    expect(await prisma.receiptConversion.count({ where: { receiptId: receipt.id } })).toBe(1);
    expect(
      await prisma.receiptConversion.count({ where: { receiptId: receipt.id, approved: true } }),
    ).toBe(1);
  });

  it("records operator, reason and correlation id when capture is given a context", async () => {
    const { user, receipt } = await ownerRateReceipt();

    await captureConversion(receipt.id, {
      operator: user.userId,
      reason: "owner-requested FX reconciliation",
      correlationId: "fx-reconciliation:run-7",
    });

    const row = await prisma.receiptConversion.findFirstOrThrow({ where: { receiptId: receipt.id } });
    expect(row.operator).toBe(user.userId);
    expect(row.reason).toBe("owner-requested FX reconciliation");
    expect(row.correlationId).toBe("fx-reconciliation:run-7");
  });

  it("returns only a source/target-compatible snapshot when currencies are given", async () => {
    const { receipt } = await ownerRateReceipt();
    await captureConversion(receipt.id);

    // The compatible pair is returned; a mismatched target is not.
    expect(await approvedConversion(receipt.id, "EGP", "USD")).not.toBeNull();
    expect(await approvedConversion(receipt.id, "EGP", "GBP")).toBeNull();
  });
});

describe("reprocessing", () => {
  it("creates a new approved version with lineage, and retains the original", async () => {
    const user = await ownerWithReportingCurrency("USD");
    const effectiveDate = new Date("2026-03-02T00:00:00Z");
    await recordManualRate({
      ownerId: user.userId,
      base: "EGP",
      quote: "USD",
      effectiveDate,
      rate: "0.0207",
      actorUserId: user.userId,
    });
    const receipt = await receiptFor(user.userId, {
      currency: "EGP",
      totalMinor: 500_00,
      purchasedAt: "2026-03-02T10:00:00Z",
    });
    await captureConversion(receipt.id);

    await recordManualRate({
      ownerId: user.userId,
      base: "EGP",
      quote: "USD",
      effectiveDate,
      rate: "0.01",
      actorUserId: user.userId,
      reason: "the bank's actual rate",
    });

    const state = await reprocessConversion(receipt.id, {
      operator: user.userId,
      reason: "rate corrected against the card statement",
      correlationId: "run-1",
    });

    expect(state.status).toBe("converted");
    if (state.status === "converted") {
      expect(state.snapshot.version).toBe(2);
      // 500.00 EGP × 0.0100 = 5.00 USD
      expect(state.snapshot.totalTargetMinor).toBe(500);
    }

    const all = await prisma.receiptConversion.findMany({
      where: { receiptId: receipt.id },
      orderBy: { version: "asc" },
    });
    expect(all).toHaveLength(2);
    expect(all[0].approved).toBe(false);
    expect(all[0].totalTargetMinor).toBe(1035);
    expect(all[1].approved).toBe(true);
    expect(all[1].parentId).toBe(all[0].id);
    expect(all[1].reason).toBe("rate corrected against the card statement");
    expect(all[1].correlationId).toBe("run-1");
  });

  it("leaves exactly one approved version behind", async () => {
    const user = await ownerWithReportingCurrency("USD");
    const effectiveDate = new Date("2026-03-02T00:00:00Z");
    await recordManualRate({
      ownerId: user.userId,
      base: "EGP",
      quote: "USD",
      effectiveDate,
      rate: "0.0207",
      actorUserId: user.userId,
    });
    const receipt = await receiptFor(user.userId, {
      currency: "EGP",
      totalMinor: 500_00,
      purchasedAt: "2026-03-02T10:00:00Z",
    });
    await captureConversion(receipt.id);

    for (const rate of ["0.01", "0.03", "0.025"]) {
      await recordManualRate({
        ownerId: user.userId,
        base: "EGP",
        quote: "USD",
        effectiveDate,
        rate,
        actorUserId: user.userId,
      });
      await reprocessConversion(receipt.id, { operator: user.userId, reason: `to ${rate}` });
    }

    expect(await prisma.receiptConversion.count({ where: { receiptId: receipt.id } })).toBe(4);
    expect(await prisma.receiptConversion.count({ where: { receiptId: receipt.id, approved: true } })).toBe(1);
  });
});
