import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { previewFxReconciliation } from "@/lib/fx/reconciliation-service";

/**
 * Phase 2 session 8 — the read-only preview behind the Settings
 * reconciliation flow.
 *
 * A POST rather than a GET even though it only reads: it must not be
 * cached by an intermediary (the counts change as receipts are added), and
 * POST is what the app's same-origin middleware protects. The owner is
 * taken from the session, never the body, so the preview only ever
 * describes the caller's own vault.
 */
export async function POST(request: NextRequest) {
  const limited = await enforceRateLimit(request, ["fx-reconciliation-preview"]);
  if (limited) return limited;

  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });

  const preview = await previewFxReconciliation(user.userId);
  return NextResponse.json(preview, { status: 200 });
}
