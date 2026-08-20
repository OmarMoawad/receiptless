import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { enforceRateLimit } from "@/lib/rate-limit";
import { receiptItemCreateSchema } from "@/lib/validation";

/**
 * Adds a line item to an existing receipt — Phase 2 session 4
 * (RECEIPTLESS_STATE.md).
 *
 * It exists because warranty and return cover hang off `ReceiptItem`, and
 * a large share of receipts arrive with no items at all: manual entry
 * captures none, and the `key-value` and `inline-summary` email adapters
 * return an empty list. Without this route the warranty feature would be
 * unreachable for exactly the receipts a person is most likely to want it
 * on — the ones they typed in themselves after buying something.
 *
 * Tenant isolation is the same shape as every other receipt-scoped route:
 * the receipt is looked up by `(id, ownerId)`, so guessing another user's
 * receipt id finds nothing under your own session.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const limited = await enforceRateLimit(request, ["receipt-write"]);
  if (limited) return limited;

  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });

  const { id } = await params;
  const receipt = await prisma.receipt.findFirst({
    where: { id, ownerId: user.userId },
    select: { id: true },
  });
  if (!receipt) return NextResponse.json({ error: "Receipt not found" }, { status: 404 });

  const body = await request.json().catch(() => null);
  if (body === null) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = receiptItemCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid item payload", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const item = await prisma.receiptItem.create({
    data: { ...parsed.data, receiptId: receipt.id },
  });

  return NextResponse.json(item, { status: 201 });
}
