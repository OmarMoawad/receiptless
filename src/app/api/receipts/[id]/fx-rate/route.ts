import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { enforceRateLimit } from "@/lib/rate-limit";
import { InvalidDecimalError } from "@/lib/fx/decimal";
import { UnknownCurrencyError } from "@/lib/fx/currency-metadata";
import { recordManualRate } from "@/lib/fx/rates";
import { captureConversion, reprocessConversion } from "@/lib/fx/conversion-service";

/**
 * Phase 2 session 7, step 2 — manual rate entry.
 *
 * This is what makes the feature work end to end with no third party at
 * all, and it is not a stopgap for the missing provider: it is what a
 * person needs anyway for a currency no provider covers, and it is the
 * only way to record *the rate their bank actually charged* rather than a
 * reference rate that disagrees with their statement.
 *
 * Scoped to one receipt on purpose. The rate is stored against the
 * owner's currency pair for that receipt's purchase date, so entering it
 * once also converts every other receipt on that day — but the entry
 * point is the receipt in front of the person, because that is where they
 * notice the number is missing.
 */
const bodySchema = z.object({
  /**
   * Quote units per one unit of the receipt's currency, as text.
   * Deliberately a string all the way from the client: JSON numbers are
   * doubles, and a rate that has been through a double is no longer the
   * rate that was typed.
   */
  rate: z.string().trim().min(1).max(32),
  reason: z.string().trim().max(500).optional(),
});

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const limited = await enforceRateLimit(request, ["receipt-write"]);
  if (limited) return limited;

  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });

  const { id } = await context.params;

  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid rate payload", issues: parsed.error.issues }, { status: 400 });
  }

  // Scoped by ownerId in the same query that finds it, so another user's
  // receipt id is indistinguishable from one that does not exist.
  const receipt = await prisma.receipt.findFirst({
    where: { id, ownerId: user.userId },
    include: { owner: { select: { reportingCurrency: true } } },
  });
  if (!receipt?.owner) return NextResponse.json({ error: "Receipt not found" }, { status: 404 });

  const base = receipt.currency.trim().toUpperCase();
  const quote = receipt.owner.reportingCurrency.trim().toUpperCase();

  if (base === quote) {
    return NextResponse.json(
      { error: `This receipt is already in ${quote}, so it needs no exchange rate.` },
      { status: 400 },
    );
  }

  try {
    await recordManualRate({
      ownerId: user.userId,
      base,
      quote,
      effectiveDate: receipt.purchasedAt,
      rate: parsed.data.rate,
      actorUserId: user.userId,
      reason: parsed.data.reason,
    });

    /**
     * A receipt that already has an approved conversion gets a new
     * *version*, not an overwrite — entering a rate a second time is a
     * correction, and a correction has to be traceable back to the figure
     * it replaced. A receipt with no conversion yet simply gets its first.
     */
    const existing = await prisma.receiptConversion.findFirst({ where: { receiptId: id, approved: true } });
    const state = existing
      ? await reprocessConversion(id, {
          operator: user.userId,
          reason: parsed.data.reason ?? "rate entered manually by the owner",
        })
      : await captureConversion(id);

    return NextResponse.json(state, { status: 200 });
  } catch (error) {
    // A rate that is not canonical, not positive or too precise is a user
    // input problem and says so, rather than surfacing as a 500.
    if (error instanceof InvalidDecimalError || error instanceof RangeError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof UnknownCurrencyError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
