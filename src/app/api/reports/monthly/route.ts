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

  const { searchParams } = new URL(request.url);
  const year = Number(searchParams.get("year") ?? new Date().getFullYear());

  const receipts = await prisma.receipt.findMany({
    where: {
      ownerId: user.userId,
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
    months[m].total += fromMinorUnits(r.totalMinor);
    months[m].count += 1;
  }

  const byCategory: Record<string, number> = {};
  for (const r of receipts) {
    byCategory[r.category] =
      (byCategory[r.category] ?? 0) + fromMinorUnits(r.totalMinor);
  }

  return NextResponse.json({ year, months, byCategory });
}
