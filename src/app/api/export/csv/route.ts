import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { csvExportStream } from "@/lib/receipt-export";

/**
 * Prisma and the streaming export both need Node APIs, so this route can
 * never run on the edge runtime. Declared rather than inferred: the
 * inference depends on what the bundler can see, and a 500 that only
 * appears once deployed is the expensive way to find that out.
 */
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  // Ahead of the session check, same order and same reason as
  // `receipts/ocr`: the work behind this route is proportional to the
  // caller's whole vault, so an unauthenticated flood should cost a
  // counter increment rather than a session lookup plus a full scan.
  const limited = await enforceRateLimit(request, ["receipt-export"]);
  if (limited) return limited;

  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });

  const date = new Date().toISOString().slice(0, 10);
  return new Response(csvExportStream(user.userId), {
    headers: {
      "cache-control": "private, no-store",
      "content-disposition": `attachment; filename="receiptless-receipts-${date}.csv"`,
      "content-type": "text/csv; charset=utf-8",
    },
  });
}
