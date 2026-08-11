import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { createReceiptSchema } from "@/lib/validation";

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
      category: data.category,
      purchasedAt: new Date(data.purchasedAt),
      source: data.source,
      verification: "UNVERIFIED",
      rawPayload: data.rawPayload,
      notes: data.notes,
      items: data.items
        ? { create: data.items }
        : undefined,
    },
    include: { merchant: true, items: true },
  });

  return NextResponse.json(receipt, { status: 201 });
}
