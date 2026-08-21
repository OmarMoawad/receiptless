import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { enforceRateLimit } from "@/lib/rate-limit";
import { reportingCurrencyInputSchema } from "@/lib/validation";

export const runtime = "nodejs";

/**
 * Session 7: reading and changing the currency a person's reports are
 * expressed in. Owner-scoped at the database boundary like every other
 * route here — nobody can read or move another account's setting.
 *
 * Changing it does **not** rewrite any stored conversion. A receipt keeps
 * the snapshot captured at its own ingest; the tax summary simply stops
 * converting receipts that now match the new reporting currency (they are
 * counted directly) and starts needing a rate for those that no longer do.
 * That is deliberate: a setting change is not a reason to silently restate
 * numbers a person may already have filed. Reprocessing an individual
 * receipt stays the explicit, audited operation it already is.
 */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });

  const row = await prisma.user.findUniqueOrThrow({
    where: { id: user.userId },
    select: { reportingCurrency: true },
  });
  return NextResponse.json({ reportingCurrency: row.reportingCurrency });
}

export async function PUT(request: NextRequest) {
  const limited = await enforceRateLimit(request, ["default-write"]);
  if (limited) return limited;

  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });

  const parsed = reportingCurrencyInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid reporting currency", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const updated = await prisma.user.update({
    where: { id: user.userId },
    data: { reportingCurrency: parsed.data.reportingCurrency },
    select: { reportingCurrency: true },
  });
  return NextResponse.json({ reportingCurrency: updated.reportingCurrency });
}
