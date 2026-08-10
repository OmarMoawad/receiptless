import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const year = Number(searchParams.get("year") ?? new Date().getFullYear());

  const receipts = await prisma.receipt.findMany({
    where: {
      purchasedAt: {
        gte: new Date(year, 0, 1),
        lt: new Date(year + 1, 0, 1),
      },
    },
  });

  const months = Array.from({ length: 12 }, (_, i) => ({
    month: i + 1,
    total: 0,
    count: 0,
  }));

  for (const r of receipts) {
    const m = r.purchasedAt.getMonth();
    months[m].total += r.amount;
    months[m].count += 1;
  }

  const byCategory: Record<string, number> = {};
  for (const r of receipts) {
    byCategory[r.category] = (byCategory[r.category] ?? 0) + r.amount;
  }

  return NextResponse.json({ year, months, byCategory });
}
