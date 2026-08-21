import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { taxSummary } from "@/lib/tax-summary";

export const runtime = "nodejs";

/**
 * Session 6. Spend per category for a tax year, owner-scoped.
 *
 * See tax-summary.ts for the deliberate omission: this does not say what
 * is deductible, because that depends on facts the app does not have.
 */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });

  const requested = request.nextUrl.searchParams.get("year");
  const year = requested === null ? new Date().getUTCFullYear() : Number(requested);

  if (!Number.isInteger(year) || year < 1970 || year > 9999) {
    return NextResponse.json({ error: "year must be a four-digit year" }, { status: 400 });
  }

  return NextResponse.json(await taxSummary(user.userId, year));
}
