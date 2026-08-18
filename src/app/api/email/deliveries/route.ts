import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { listUnimportedDeliveries } from "@/lib/delivery-reprocessing";

/**
 * The review surface for review findings #6/#7: mail that arrived and did
 * not become a receipt.
 *
 * Without it, "12 messages were not imported" is a number with nothing
 * behind it — the owner cannot tell whether the app missed twelve
 * receipts or skipped twelve newsletters, and those are the difference
 * between a bug and correct behaviour.
 */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });

  return NextResponse.json(await listUnimportedDeliveries(user.userId));
}
