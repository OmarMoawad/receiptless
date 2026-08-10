import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { createReceiptSchema } from "@/lib/validation";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const year = searchParams.get("year");
  const month = searchParams.get("month");

  const where: Record<string, unknown> = {};
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
      imageUrl: data.imageUrl,
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
