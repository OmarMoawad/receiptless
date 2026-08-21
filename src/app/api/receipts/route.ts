import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { createReceiptSchema } from "@/lib/validation";
import { enforceRateLimit } from "@/lib/rate-limit";
import { classifyForOwner } from "@/lib/classify-receipt";
import { captureConversionQuietly } from "@/lib/fx/conversion-service";

/**
 * Session 3 (RECEIPTLESS_STATE.md): every receipt-facing route requires a
 * session and scopes its query by `ownerId` — a receipt with no owner
 * (merchant-pushed, not yet claimed via /api/claim/[token]) never appears
 * here, and one user's vault never leaks into another's list/search/reports.
 */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  const year = searchParams.get("year");
  const month = searchParams.get("month");

  const where: Record<string, unknown> = { ownerId: user.userId };
  if (id) where.id = id;
  if (year) {
    const y = Number(year);
    const m = month ? Number(month) : null;
    const start = m ? new Date(y, m - 1, 1) : new Date(y, 0, 1);
    const end = m ? new Date(y, m, 1) : new Date(y + 1, 0, 1);
    where.purchasedAt = { gte: start, lt: end };
  }

  const receipts = await prisma.receipt.findMany({
    where,
    include: { merchant: true, items: true },
    orderBy: { purchasedAt: "desc" },
  });
  return NextResponse.json(receipts);
}

export async function POST(request: NextRequest) {
  const limited = await enforceRateLimit(request, ["receipt-write"]);
  if (limited) return limited;

  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (body === null) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = createReceiptSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid receipt payload", issues: parsed.error.issues },
      { status: 400 }
    );
  }
  const data = parsed.data;

  const merchant = await prisma.merchant.upsert({
    where: { name: data.merchant },
    update: {},
    create: { name: data.merchant },
  });

  /**
   * Session 6: the rules layer fills in what the caller left as OTHER,
   * for the receipt and for every item. It never overwrites a category
   * that was chosen — see classify-receipt.ts for why OTHER is read as
   * "no opinion" rather than as a choice.
   */
  const classified = await classifyForOwner(user.userId, {
    merchantName: data.merchant,
    category: data.category,
    items: data.items,
  });

  const receipt = await prisma.receipt.create({
    data: {
      ownerId: user.userId,
      merchantId: merchant.id,
      currency: data.currency,
      totalMinor: data.totalMinor,
      subtotalMinor: data.subtotalMinor,
      taxMinor: data.taxMinor,
      discountMinor: data.discountMinor,
      feeMinor: data.feeMinor,
      category: classified.category,
      purchasedAt: new Date(data.purchasedAt),
      source: data.source,
      verification: "UNVERIFIED",
      rawPayload: data.rawPayload,
      notes: data.notes,
      items: data.items
        ? { create: data.items.map((item, index) => ({ ...item, category: classified.items[index] })) }
        : undefined,
    },
    include: { merchant: true, items: true },
  });

  // Session 7: the rate is captured now, at ingest, and stored on the
  // receipt — not looked up later when a report happens to be opened.
  await captureConversionQuietly(receipt.id);

  return NextResponse.json(receipt, { status: 201 });
}
