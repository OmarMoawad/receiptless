import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { taxSummaryCsv } from "@/lib/tax-summary-export";

export const runtime = "nodejs";

/**
 * Session 6. The tax summary as a file, which is the form it is actually
 * used in — nobody retypes a year of totals off a web page into a return.
 *
 * Shares `receipt-export`'s bucket with the other two exports: the cost
 * being limited is a full-vault walk, and this walks a year of it.
 */
export async function GET(request: NextRequest) {
  const limited = await enforceRateLimit(request, ["receipt-export"]);
  if (limited) return limited;

  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });

  const requested = request.nextUrl.searchParams.get("year");
  const year = requested === null ? new Date().getUTCFullYear() : Number(requested);

  if (!Number.isInteger(year) || year < 1970 || year > 9999) {
    return NextResponse.json({ error: "year must be a four-digit year" }, { status: 400 });
  }

  const csv = await taxSummaryCsv(user.userId, year);

  return new Response(csv, {
    headers: {
      "cache-control": "private, no-store",
      "content-disposition": `attachment; filename="receiptless-tax-summary-${year}.csv"`,
      "content-type": "text/csv; charset=utf-8",
    },
  });
}
