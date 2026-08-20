import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import {
  addMonthsUtc,
  describeDaysLeft,
  listCoverage,
  returnWindow,
  warrantyWindow,
} from "./coverage";

const NOW = new Date("2026-08-20T13:45:00.000Z");

async function createOwner(): Promise<string> {
  const user = await prisma.user.create({
    data: {
      username: `coverage_${randomUUID().replace(/-/g, "").slice(0, 12)}`,
      passwordHash: "not-a-real-hash",
    },
  });
  return user.id;
}

async function createReceiptWithItems(input: {
  ownerId: string;
  purchasedAt: Date;
  items: Array<{ name: string; warrantyMonths?: number; returnWindowDays?: number }>;
}) {
  const merchant = await prisma.merchant.upsert({
    where: { name: `Coverage Co ${randomUUID().slice(0, 8)}` },
    update: {},
    create: { name: `Coverage Co ${randomUUID().slice(0, 8)}` },
  });
  return prisma.receipt.create({
    data: {
      ownerId: input.ownerId,
      merchantId: merchant.id,
      currency: "GBP",
      totalMinor: 9900,
      purchasedAt: input.purchasedAt,
      source: "MANUAL",
      items: {
        create: input.items.map((item) => ({
          name: item.name,
          unitPriceMinor: 9900,
          totalPriceMinor: 9900,
          warrantyMonths: item.warrantyMonths ?? null,
          returnWindowDays: item.returnWindowDays ?? null,
        })),
      },
    },
  });
}

describe("calendar arithmetic", () => {
  it("clamps to the end of a shorter month instead of overflowing", () => {
    // The case that makes naive `setMonth` arithmetic wrong: 31 January
    // plus one month is 3 March, not 28 February, if the day of month is
    // carried over unclamped.
    expect(addMonthsUtc(new Date("2026-01-31T00:00:00Z"), 1).toISOString().slice(0, 10)).toBe(
      "2026-02-28",
    );
  });

  it("lands on 29 February in a leap year", () => {
    expect(addMonthsUtc(new Date("2028-01-31T00:00:00Z"), 1).toISOString().slice(0, 10)).toBe(
      "2028-02-29",
    );
  });

  it("crosses year boundaries", () => {
    expect(addMonthsUtc(new Date("2026-08-20T00:00:00Z"), 24).toISOString().slice(0, 10)).toBe(
      "2028-08-20",
    );
  });
});

describe("warranty and return windows", () => {
  it("distinguishes no cover from expired cover", () => {
    // A null is not a zero. "This item has no recorded warranty" and "this
    // item's warranty ran out" are different answers, and a UI that shows
    // the second when it means the first is lying.
    expect(warrantyWindow(new Date("2020-01-01T00:00:00Z"), null, NOW)).toBeNull();
    expect(warrantyWindow(new Date("2020-01-01T00:00:00Z"), 12, NOW)?.status).toBe("expired");
  });

  it("counts the last day as still covered", () => {
    // Bought 14 days ago with a 14-day return window: today is the last
    // day it can go back, not the first day it cannot.
    const purchased = new Date("2026-08-06T09:00:00Z");
    const window = returnWindow(purchased, 14, NOW);
    expect(window?.daysLeft).toBe(0);
    expect(window?.status).toBe("ending-soon");
    expect(describeDaysLeft(window!)).toBe("ends today");
  });

  it("ignores the time of day on the purchase timestamp", () => {
    // Two receipts from the same day, one stamped just after midnight and
    // one just before it, must expire together — otherwise the answer to
    // "can I return this?" depends on what time the shop's system happened
    // to fire the receipt.
    const early = returnWindow(new Date("2026-08-06T00:01:00Z"), 14, NOW);
    const late = returnWindow(new Date("2026-08-06T23:59:00Z"), 14, NOW);
    expect(early?.endsAt.toISOString()).toBe(late?.endsAt.toISOString());
  });

  it("flags a warranty inside its final month but not before", () => {
    expect(warrantyWindow(new Date("2025-09-05T00:00:00Z"), 12, NOW)?.status).toBe("ending-soon");
    expect(warrantyWindow(new Date("2026-08-01T00:00:00Z"), 24, NOW)?.status).toBe("active");
  });
});

describe("listCoverage", () => {
  let owner: string;
  let other: string;

  beforeAll(async () => {
    owner = await createOwner();
    other = await createOwner();

    await createReceiptWithItems({
      ownerId: owner,
      purchasedAt: new Date("2026-08-15T00:00:00Z"),
      items: [
        { name: "Kettle", warrantyMonths: 24, returnWindowDays: 30 },
        { name: "Loose tea" },
      ],
    });
    await createReceiptWithItems({
      ownerId: owner,
      purchasedAt: new Date("2026-08-18T00:00:00Z"),
      items: [{ name: "Headphones", returnWindowDays: 7 }],
    });
    await createReceiptWithItems({
      ownerId: owner,
      purchasedAt: new Date("2019-01-10T00:00:00Z"),
      items: [{ name: "Old toaster", warrantyMonths: 12, returnWindowDays: 14 }],
    });
    await createReceiptWithItems({
      ownerId: owner,
      purchasedAt: new Date("2025-02-01T00:00:00Z"),
      items: [{ name: "Laptop", warrantyMonths: 36, returnWindowDays: 14 }],
    });
    await createReceiptWithItems({
      ownerId: other,
      purchasedAt: new Date("2026-08-15T00:00:00Z"),
      items: [{ name: "Someone else's drill", warrantyMonths: 24 }],
    });
  });

  it("returns only items that carry cover", async () => {
    const entries = await listCoverage(owner, NOW);
    const names = entries.map((entry) => entry.itemName);
    expect(names).toContain("Kettle");
    // No warranty, no return window, so it is not a coverage row at all.
    expect(names).not.toContain("Loose tea");
  });

  it("never crosses tenants", async () => {
    const entries = await listCoverage(owner, NOW);
    expect(entries.map((entry) => entry.itemName)).not.toContain("Someone else's drill");
  });

  it("hides an item only when everything on it has expired", async () => {
    const entries = await listCoverage(owner, NOW);
    const names = entries.map((entry) => entry.itemName);
    // The laptop's 14-day return window closed in February 2025 and its
    // 36-month warranty runs to 2028 — the exact case a per-window filter
    // would wrongly drop.
    expect(names).toContain("Laptop");
    expect(names).not.toContain("Old toaster");
  });

  it("includes fully expired items on request", async () => {
    const entries = await listCoverage(owner, NOW, { includeExpired: true });
    expect(entries.map((entry) => entry.itemName)).toContain("Old toaster");
  });

  it("orders by whatever runs out first", async () => {
    const entries = await listCoverage(owner, NOW);
    const names = entries.map((entry) => entry.itemName);
    // Headphones' return window closes 25 Aug, the kettle's 14 Sep, the
    // laptop's warranty not until 2028.
    expect(names.indexOf("Headphones")).toBeLessThan(names.indexOf("Kettle"));
    expect(names.indexOf("Kettle")).toBeLessThan(names.indexOf("Laptop"));
  });
});
