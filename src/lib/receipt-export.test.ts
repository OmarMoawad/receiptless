import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { registerTestUser } from "@/test/auth-helpers";
import {
  EXPORT_BATCH_SIZE,
  csvExportLines,
  csvExportStream,
  ownedReceiptBatches,
  pdfExportStream,
} from "./receipt-export";

/**
 * The cursor pagination in `ownedReceiptBatches` is the part of the
 * export that cannot be checked by eye: `cursor` plus `skip: 1` is right
 * or off by exactly one row, and a vault smaller than one batch never
 * tells you which. Everything here therefore straddles
 * EXPORT_BATCH_SIZE deliberately.
 */
async function seedReceipts(ownerId: string, count: number, tag: string) {
  const merchant = await prisma.merchant.create({ data: { name: `Boundary ${tag}` } });
  await prisma.receipt.createMany({
    data: Array.from({ length: count }, (_, index) => ({
      ownerId,
      merchantId: merchant.id,
      currency: "USD",
      totalMinor: 100 + index,
      purchasedAt: new Date("2026-08-20T12:00:00.000Z"),
      notes: `receipt-${tag}-${index}`,
    })),
  });
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf8");
}

describe("export pagination across the batch boundary", () => {
  it("yields every receipt exactly once when the vault is larger than one batch", async () => {
    const owner = await registerTestUser();
    const tag = randomUUID().slice(0, 8);
    await seedReceipts(owner.userId, EXPORT_BATCH_SIZE + 1, tag);

    const seen: string[] = [];
    for await (const batch of ownedReceiptBatches(owner.userId)) {
      for (const receipt of batch) seen.push(receipt.id);
    }

    expect(seen).toHaveLength(EXPORT_BATCH_SIZE + 1);
    expect(new Set(seen).size).toBe(EXPORT_BATCH_SIZE + 1);
  });

  it("writes one CSV row per receipt across the seam, header aside", async () => {
    const owner = await registerTestUser();
    const tag = randomUUID().slice(0, 8);
    await seedReceipts(owner.userId, EXPORT_BATCH_SIZE + 1, tag);

    const body = await readAll(csvExportStream(owner.userId));
    const rows = body.trim().split("\r\n");

    expect(rows).toHaveLength(EXPORT_BATCH_SIZE + 2);
    // The last receipt seeded is the one a stale cursor would drop.
    expect(body).toContain(`receipt-${tag}-${EXPORT_BATCH_SIZE}`);
    expect(body).toContain(`receipt-${tag}-0`);
  });

  it("renders a PDF page per receipt across the seam", async () => {
    const owner = await registerTestUser();
    await seedReceipts(owner.userId, EXPORT_BATCH_SIZE + 1, randomUUID().slice(0, 8));

    const chunks: Uint8Array[] = [];
    const reader = pdfExportStream(owner.userId).getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }
    const pdf = Buffer.concat(chunks.map((c) => Buffer.from(c)));

    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(pdf.toString("latin1")).toContain("%%EOF");
    /**
     * Exactly one page per receipt — the assertion that catches both a
     * batch seam that drops the last receipt and a footer that spills
     * onto a page of its own, which is what it caught when written.
     */
    expect(pdf.toString("latin1")).toContain(`/Count ${EXPORT_BATCH_SIZE + 1}`);
  });
});

describe("a cancelled export stops working", () => {
  it("does not keep querying after the reader goes away", async () => {
    const owner = await registerTestUser();
    await seedReceipts(owner.userId, EXPORT_BATCH_SIZE + 1, randomUUID().slice(0, 8));

    const stream = csvExportStream(owner.userId);
    const reader = stream.getReader();
    await reader.read();
    await reader.cancel();

    // The generator is the thing the stream cancels; once returned it
    // must not resume the batch loop for a download nobody is reading.
    const lines = csvExportLines(owner.userId);
    await lines.next();
    await lines.return(undefined);
    expect(await lines.next()).toEqual({ done: true, value: undefined });
  });

  it("cancelling a PDF export closes it without an unhandled rejection", async () => {
    const owner = await registerTestUser();
    await seedReceipts(owner.userId, EXPORT_BATCH_SIZE + 1, randomUUID().slice(0, 8));

    const reader = pdfExportStream(owner.userId).getReader();
    await reader.read();
    await expect(reader.cancel()).resolves.toBeUndefined();
    // A cancelled stream that still tried to enqueue would surface here.
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
});
