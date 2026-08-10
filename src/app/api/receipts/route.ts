import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { Category, ReceiptSource } from "@/generated/prisma/client";

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
    orderBy: { purchasedAt: "desc" },
  });
  return NextResponse.json(receipts);
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { merchant, amount, currency, category, purchasedAt, source, imageUrl, rawPayload, notes } = body;

  if (!merchant || typeof amount !== "number" || !purchasedAt) {
    return NextResponse.json(
      { error: "merchant, amount, and purchasedAt are required" },
      { status: 400 }
    );
  }

  const receipt = await prisma.receipt.create({
    data: {
      merchant,
      amount,
      currency: currency ?? "USD",
      category: (category as Category) ?? Category.OTHER,
      purchasedAt: new Date(purchasedAt),
      source: (source as ReceiptSource) ?? ReceiptSource.MANUAL,
      imageUrl,
      rawPayload,
      notes,
    },
  });

  return NextResponse.json(receipt, { status: 201 });
}
