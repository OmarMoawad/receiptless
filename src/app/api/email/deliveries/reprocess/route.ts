import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { reprocessUnparsedDeliveries } from "@/lib/delivery-reprocessing";
import { enforceRateLimit } from "@/lib/rate-limit";

/**
 * Runs the current parser over messages an earlier parser could not read
 * (review findings #6/#7). Owner-scoped, bounded per call, and triggered
 * explicitly rather than by a background job — the review asked for
 * *controlled* reprocessing, and a scheduled reparse of everyone's mail
 * is the opposite of controlled.
 *
 * Rate limited on the sync bucket: it is the same shape of work as a
 * mailbox scan (a burst of parses on request), and the same ceiling
 * applies.
 */
export async function POST(request: NextRequest) {
  const limited = await enforceRateLimit(request, ["provider-sync"]);
  if (limited) return limited;

  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });

  return NextResponse.json(await reprocessUnparsedDeliveries(user.userId));
}
