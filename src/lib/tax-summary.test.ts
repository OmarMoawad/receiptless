import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { registerTestUser } from "@/test/auth-helpers";
import { taxSummary, taxYearRange } from "./tax-summary";
import { recordManualRate } from "./fx/rates";
import { captureConversion } from "./fx/conversion-service";
import { taxSummaryCsv } from "./tax-summary-export";

async function receipt(
  ownerId: string,
  options: {
    merchant: string;
    category: "GROCERIES" | "DINING" | "HEALTH" | "OTHER";
    totalMinor: number;
    purchasedAt: string;
    currency?: string;
    items?: { name: string; category: "GROCERIES" | "HEALTH"; totalPriceMinor: number }[];
  },
) {
  const merchant = await prisma.merchant.create({ data: { name: options.merchant } });
  return prisma.receipt.create({
    data: {
      ownerId,
      merchantId: merchant.id,
      currency: options.currency ?? "USD",
      totalMinor: options.totalMinor,
      category: options.category,
      purchasedAt: new Date(options.purchasedAt),
      items: options.items
        ? {
            create: options.items.map((item) => ({
              name: item.name,
              category: item.category,
              quantity: 1,
              unitPriceMinor: item.totalPriceMinor,
              totalPriceMinor: item.totalPriceMinor,
            })),
          }
        : undefined,
    },
  });
}

describe("the tax year boundary", () => {
  it("is a UTC calendar year, half-open", () => {
    const { start, end } = taxYearRange(2026);
    expect(start.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(end.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });
});

describe("the tax summary", () => {
  it("totals receipts per category and excludes other years", async () => {
    const owner = await registerTestUser();
    const tag = randomUUID().slice(0, 8);

    await receipt(owner.userId, {
      merchant: `Shop ${tag}`,
      category: "GROCERIES",
      totalMinor: 1000,
      purchasedAt: "2026-03-01T00:00:00.000Z",
    });
    await receipt(owner.userId, {
      merchant: `Cafe ${tag}`,
      category: "DINING",
      totalMinor: 250,
      purchasedAt: "2026-06-01T00:00:00.000Z",
    });
    // The boundary cases: the last instant of the previous year and the
    // first of the next must both fall outside.
    await receipt(owner.userId, {
      merchant: `Old ${tag}`,
      category: "GROCERIES",
      totalMinor: 9999,
      purchasedAt: "2025-12-31T23:59:59.999Z",
    });
    await receipt(owner.userId, {
      merchant: `New ${tag}`,
      category: "GROCERIES",
      totalMinor: 8888,
      purchasedAt: "2027-01-01T00:00:00.000Z",
    });

    const summary = await taxSummary(owner.userId, 2026);

    expect(summary.receiptCount).toBe(2);
    expect(summary.totalMinor).toBe(1250);
    expect(summary.lines.find((l) => l.category === "GROCERIES")?.totalMinor).toBe(1000);
    expect(summary.lines.find((l) => l.category === "DINING")?.totalMinor).toBe(250);
  });

  it("counts items in their own category, not the receipt's", async () => {
    const owner = await registerTestUser();
    const tag = randomUUID().slice(0, 8);

    await receipt(owner.userId, {
      merchant: `Grocer ${tag}`,
      category: "GROCERIES",
      totalMinor: 1500,
      purchasedAt: "2026-04-01T00:00:00.000Z",
      items: [
        { name: "Bread", category: "GROCERIES", totalPriceMinor: 500 },
        { name: "Paracetamol", category: "HEALTH", totalPriceMinor: 1000 },
      ],
    });

    const summary = await taxSummary(owner.userId, 2026);
    const health = summary.lines.find((l) => l.category === "HEALTH");

    // The whole point of item-level categories: health spending that
    // happened inside a grocery shop is still health spending, and the
    // receipt total stays where it belongs.
    expect(health?.itemTotalMinor).toBe(1000);
    expect(health?.receiptCount).toBe(0);
    expect(summary.lines.find((l) => l.category === "GROCERIES")?.totalMinor).toBe(1500);
  });

  it("never includes another owner's receipts", async () => {
    const owner = await registerTestUser();
    const stranger = await registerTestUser();
    const tag = randomUUID().slice(0, 8);

    await receipt(stranger.userId, {
      merchant: `Private ${tag}`,
      category: "DINING",
      totalMinor: 4321,
      purchasedAt: "2026-05-01T00:00:00.000Z",
    });

    const summary = await taxSummary(owner.userId, 2026);
    expect(summary.totalMinor).toBe(0);
    expect(summary.receiptCount).toBe(0);
  });

  it("names a foreign receipt with no rate rather than adding it in", async () => {
    const owner = await registerTestUser();
    const tag = randomUUID().slice(0, 8);

    await receipt(owner.userId, {
      merchant: `Usd ${tag}`,
      category: "OTHER",
      totalMinor: 1000,
      purchasedAt: "2026-02-01T00:00:00.000Z",
      currency: "USD",
    });
    await receipt(owner.userId, {
      merchant: `Eur ${tag}`,
      category: "OTHER",
      totalMinor: 100,
      purchasedAt: "2026-02-02T00:00:00.000Z",
      currency: "EUR",
    });

    const summary = await taxSummary(owner.userId, 2026);

    // Session 7: the EUR receipt has no stored conversion, so it is
    // excluded and named rather than summed at some invented rate.
    expect(summary.currency).toBe("USD");
    expect(summary.totalMinor).toBe(1000);
    expect(summary.receiptCount).toBe(1);
    expect(summary.unconverted).toEqual([{ currency: "EUR", receiptCount: 1, totalMinor: 100 }]);
  });

  it("converts a foreign receipt once a rate is stored against it", async () => {
    const owner = await registerTestUser();
    const tag = randomUUID().slice(0, 8);

    await recordManualRate({
      ownerId: owner.userId,
      base: "EUR",
      quote: "USD",
      effectiveDate: new Date("2026-02-02T00:00:00.000Z"),
      rate: "1.08",
      actorUserId: owner.userId,
    });

    await receipt(owner.userId, {
      merchant: `Usd ${tag}`,
      category: "OTHER",
      totalMinor: 1000,
      purchasedAt: "2026-02-01T00:00:00.000Z",
      currency: "USD",
    });
    const foreign = await receipt(owner.userId, {
      merchant: `Eur ${tag}`,
      category: "OTHER",
      totalMinor: 100,
      purchasedAt: "2026-02-02T00:00:00.000Z",
      currency: "EUR",
    });
    await captureConversion(foreign.id);

    const summary = await taxSummary(owner.userId, 2026);

    // €1.00 at 1.08 = $1.08, added to the $10.00 receipt.
    expect(summary.totalMinor).toBe(1108);
    expect(summary.receiptCount).toBe(2);
    expect(summary.unconverted).toEqual([]);
  });

  it("does not move a converted total when the rate is later corrected", async () => {
    const owner = await registerTestUser();
    const tag = randomUUID().slice(0, 8);
    const effectiveDate = new Date("2026-02-02T00:00:00.000Z");

    await recordManualRate({
      ownerId: owner.userId,
      base: "EUR",
      quote: "USD",
      effectiveDate,
      rate: "1.08",
      actorUserId: owner.userId,
    });
    const foreign = await receipt(owner.userId, {
      merchant: `Eur ${tag}`,
      category: "OTHER",
      totalMinor: 100,
      purchasedAt: "2026-02-02T00:00:00.000Z",
      currency: "EUR",
    });
    await captureConversion(foreign.id);

    // The requirement in one assertion: a rate correction must not
    // silently restate a figure someone may already have filed on.
    await recordManualRate({
      ownerId: owner.userId,
      base: "EUR",
      quote: "USD",
      effectiveDate,
      rate: "2",
      actorUserId: owner.userId,
      reason: "corrected",
    });

    expect((await taxSummary(owner.userId, 2026)).totalMinor).toBe(108);
  });
});

describe("the CSV export of it", () => {
  it("carries the totals and a TOTAL row", async () => {
    const owner = await registerTestUser();
    const tag = randomUUID().slice(0, 8);
    await receipt(owner.userId, {
      merchant: `Shop ${tag}`,
      category: "GROCERIES",
      totalMinor: 1000,
      purchasedAt: "2026-03-01T00:00:00.000Z",
    });

    const csv = await taxSummaryCsv(owner.userId, 2026);
    expect(csv).toContain("category,receipt_count,receipt_total_minor");
    expect(csv).toContain("GROCERIES,1,1000");
    expect(csv).toContain("TOTAL,1,1000");
  });

  it("puts the excluded-receipt warning in the file, not only on the page", async () => {
    const owner = await registerTestUser();
    const tag = randomUUID().slice(0, 8);
    await receipt(owner.userId, {
      merchant: `A ${tag}`,
      category: "OTHER",
      totalMinor: 1000,
      purchasedAt: "2026-02-01T00:00:00.000Z",
      currency: "USD",
    });
    await receipt(owner.userId, {
      merchant: `B ${tag}`,
      category: "OTHER",
      totalMinor: 100,
      purchasedAt: "2026-02-02T00:00:00.000Z",
      currency: "EUR",
    });

    const csv = await taxSummaryCsv(owner.userId, 2026);
    // The file outlives the page it came from, so the caveat has to
    // travel with it. Session 7 narrowed what the caveat says: the EUR
    // receipt is excluded for want of a rate, and the file has to name it
    // rather than present a total that quietly omits it.
    expect(csv).toContain("WARNING");
    expect(csv).toContain("EXCLUDED from the totals above");
    expect(csv).toContain("1 receipt(s) in EUR");
    // And it states what the totals it *does* show actually mean.
    expect(csv).toContain("never at today's rate");
  });
});
