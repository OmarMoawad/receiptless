import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { pdfExportStream } from "@/lib/receipt-export";

/**
 * Prisma and pdfkit both need Node APIs, so this route can never run on
 * the edge runtime. Declared rather than inferred — see the note in
 * `receipt-export.ts` about pdfkit's font metrics, which is the same
 * class of failure: correct locally, 500 only once bundled.
 */
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  // Ahead of the session check on purpose — see the CSV route. The PDF is
  // the heavier of the two: a page rendered per receipt, on top of the
  // same full-vault scan.
  const limited = await enforceRateLimit(request, ["receipt-export"]);
  if (limited) return limited;

  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });

  const date = new Date().toISOString().slice(0, 10);
  return new Response(pdfExportStream(user.userId), {
    headers: {
      "cache-control": "private, no-store",
      "content-disposition": `attachment; filename="receiptless-archive-${date}.pdf"`,
      "content-type": "application/pdf",
    },
  });
}
