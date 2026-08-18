import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { describeMatch, searchReceipts } from "./search";

async function createUser(): Promise<string> {
  const user = await prisma.user.create({
    data: { username: `search_${randomUUID().replace(/-/g, "").slice(0, 12)}`, passwordHash: "not-a-real-hash" },
  });
  return user.id;
}

async function createReceipt(input: {
  ownerId: string;
  merchant: string;
  items?: string[];
  notes?: string;
  purchasedAt?: Date;
}) {
  const merchant = await prisma.merchant.upsert({
    where: { name: input.merchant },
    update: {},
    create: { name: input.merchant },
  });
  return prisma.receipt.create({
    data: {
      ownerId: input.ownerId,
      merchantId: merchant.id,
      currency: "GBP",
      totalMinor: 1000,
      purchasedAt: input.purchasedAt ?? new Date("2026-08-01"),
      source: "MANUAL",
      notes: input.notes,
      items: input.items?.length
        ? { create: input.items.map((name) => ({ name, unitPriceMinor: 100, totalPriceMinor: 100 })) }
        : undefined,
    },
  });
}

describe("full-text search", () => {
  let owner: string;

  beforeAll(async () => {
    owner = await createUser();
    await createReceipt({
      ownerId: owner,
      merchant: `Brew Bar ${randomUUID().slice(0, 6)}`,
      items: ["Flat white", "Almond croissant"],
    });
    await createReceipt({ ownerId: owner, merchant: `Corner Grocery ${randomUUID().slice(0, 6)}`, items: ["Milk 1L"], notes: "Weekly shop, returns accepted" });
  });

  it("finds an item regardless of case — the bug the old search had", async () => {
    // Prisma's `contains` without mode:"insensitive" compiles to LIKE,
    // which is case-sensitive in Postgres, so this exact query used to
    // return nothing at all.
    const hits = await searchReceipts(owner, "flat white");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].matchedOn.items).toContain("Flat white");
  });

  it("stems, so a different form of the word still matches", async () => {
    // "return" finds "returns" — a substring match cannot do this.
    const hits = await searchReceipts(owner, "return");
    expect(hits.some((hit) => hit.matchedOn.notes)).toBe(true);
  });

  it("says why each receipt matched", async () => {
    const hits = await searchReceipts(owner, "croissant");
    expect(describeMatch(hits[0].matchedOn)).toContain("Almond croissant");
  });

  it("ranks a merchant-name match above a note mentioning the same word", async () => {
    const marker = `zeta${randomUUID().replace(/-/g, "").slice(0, 8)}`;
    await createReceipt({ ownerId: owner, merchant: `${marker} Coffee`, items: ["Espresso"] });
    await createReceipt({ ownerId: owner, merchant: `Unrelated ${randomUUID().slice(0, 6)}`, notes: `bought at ${marker}` });

    const hits = await searchReceipts(owner, marker);

    expect(hits).toHaveLength(2);
    // Weighting is the whole point: merchant is weight A, notes weight C.
    expect(hits[0].matchedOn.merchant).toBe(true);
    expect(hits[1].matchedOn.notes).toBe(true);
    expect(hits[0].rank).toBeGreaterThan(hits[1].rank);
  });

  it("indexes items even though they are inserted after their receipt", async () => {
    // Prisma's nested create inserts the receipt first, so without the
    // ReceiptItem trigger every item name would be missing from the index
    // of the receipt that owns it.
    const marker = `itm${randomUUID().replace(/-/g, "").slice(0, 8)}`;
    await createReceipt({ ownerId: owner, merchant: `Shop ${randomUUID().slice(0, 6)}`, items: [`${marker} widget`] });

    const hits = await searchReceipts(owner, marker);
    expect(hits).toHaveLength(1);
    expect(hits[0].matchedOn.viaFallback).toBe(false);
  });

  it("re-indexes when a merchant is renamed", async () => {
    const marker = `ren${randomUUID().replace(/-/g, "").slice(0, 8)}`;
    const receipt = await createReceipt({ ownerId: owner, merchant: `Before ${randomUUID().slice(0, 6)}` });
    await prisma.merchant.update({ where: { id: receipt.merchantId }, data: { name: `${marker} Renamed` } });

    const hits = await searchReceipts(owner, marker);
    expect(hits.map((hit) => hit.receipt.id)).toContain(receipt.id);
  });

  it("falls back to a substring scan for a half-typed word, and says so", async () => {
    const marker = `prefix${randomUUID().replace(/-/g, "").slice(0, 6)}`;
    await createReceipt({ ownerId: owner, merchant: `${marker}shop` });

    // Full text matches whole words, so a partial one finds nothing —
    // indistinguishable, to a user, from owning no such receipt.
    const hits = await searchReceipts(owner, marker.slice(0, 8));

    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].matchedOn.viaFallback).toBe(true);
    expect(hits[0].rank).toBe(0);
  });

  it("returns nothing for an empty query rather than everything", async () => {
    expect(await searchReceipts(owner, "   ")).toEqual([]);
  });

  it("never returns another owner's receipts", async () => {
    const stranger = await createUser();
    const marker = `priv${randomUUID().replace(/-/g, "").slice(0, 8)}`;
    await createReceipt({ ownerId: owner, merchant: `${marker} Private` });

    expect(await searchReceipts(stranger, marker)).toEqual([]);
  });

  it("does not fall over on punctuation from a URL parameter", async () => {
    // websearch_to_tsquery never throws on malformed input; plainto_ and
    // to_tsquery can. This comes straight from ?q=.
    for (const nasty of ["'", '"unclosed', "a & b | c", "-", "!!!"]) {
      await expect(searchReceipts(owner, nasty)).resolves.toBeInstanceOf(Array);
    }
  });
});
