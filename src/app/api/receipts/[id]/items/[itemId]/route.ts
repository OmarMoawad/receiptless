import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { enforceRateLimit } from "@/lib/rate-limit";
import { itemCoverageSchema } from "@/lib/validation";

/**
 * Sets (or clears) an item's warranty and return window — Phase 2 session 4
 * (RECEIPTLESS_STATE.md). Deliberately narrow: this route edits the two
 * coverage columns and nothing else, so it can never become a way to
 * rewrite a merchant-pushed receipt's prices, names, or totals. Amending
 * what a merchant attested is a different action with a different trust
 * question attached, and it is not this one.
 *
 * Both the receipt *and* the item are matched in a single `where`, so an
 * item id belonging to somebody else's receipt is a 404 rather than an
 * edit — the nesting in the URL is not what enforces ownership, the query
 * is.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> },
) {
  const limited = await enforceRateLimit(request, ["receipt-write"]);
  if (limited) return limited;

  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });

  const { id, itemId } = await params;

  const body = await request.json().catch(() => null);
  if (body === null) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = itemCoverageSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid coverage payload", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const item = await prisma.receiptItem.findFirst({
    where: { id: itemId, receiptId: id, receipt: { ownerId: user.userId } },
    select: { id: true },
  });
  if (!item) return NextResponse.json({ error: "Item not found" }, { status: 404 });

  const updated = await prisma.receiptItem.update({
    where: { id: item.id },
    data: parsed.data,
  });

  return NextResponse.json(updated);
}
