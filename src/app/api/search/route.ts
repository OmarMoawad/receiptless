import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

/**
 * Minimal vault search: substring match across merchant name and item
 * names. This is a placeholder for real full-text/semantic search
 * (ROADMAP.md, vault phase) — good enough to prove "find my AirPods
 * receipt" works before investing in a proper search index.
 */
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q")?.trim();
  if (!q) return NextResponse.json([]);

  const receipts = await prisma.receipt.findMany({
    where: {
      OR: [
        { merchant: { name: { contains: q } } },
        { notes: { contains: q } },
        { items: { some: { name: { contains: q } } } },
      ],
    },
    include: { merchant: true, items: true },
    orderBy: { purchasedAt: "desc" },
    take: 50,
  });

  return NextResponse.json(receipts);
}
