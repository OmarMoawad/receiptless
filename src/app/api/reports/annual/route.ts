import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { fromMinorUnits } from "@/lib/money";

// Session 3 (RECEIPTLESS_STATE.md): scoped by `ownerId` — a report never
// aggregates another user's spending, and an unclaimed receipt (no owner
// yet) is never counted.
export async function GET(request: NextRequest) {
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });

  const receipts = await prisma.receipt.findMany({ where: { ownerId: user.userId } });

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
