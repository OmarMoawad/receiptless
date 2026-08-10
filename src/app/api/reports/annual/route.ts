import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { fromMinorUnits } from "@/lib/money";

export async function GET() {
  const receipts = await prisma.receipt.findMany();

  const byYear: Record<number, { total: number; count: number }> = {};
  for (const r of receipts) {
    const y = r.purchasedAt.getFullYear();
    byYear[y] ??= { total: 0, count: 0 };
    byYear[y].total += fromMinorUnits(r.totalMinor);
    byYear[y].count += 1;
  }

  const years = Object.entries(byYear)
    .map(([year, data]) => ({ year: Number(year), ...data }))
    .sort((a, b) => a.year - b.year);

  return NextResponse.json({ years });
}
