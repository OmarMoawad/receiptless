import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { csvExportStream } from "@/lib/receipt-export";

export async function GET(request: NextRequest) {
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
