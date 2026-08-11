import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { resolveClaim } from "@/lib/claim";
import { isSameOrigin } from "@/lib/origin-check";

/**
 * Resolves a claim token from the QR claim-token protocol (see
 * merchant/receipts route and ROADMAP.md), and attaches the receipt to the
 * caller's account — see src/lib/claim.ts for the atomic claim+attach
 * semantics. Requires an authenticated session (Session 3,
 * RECEIPTLESS_STATE.md): claim attach reassigns account ownership from a
 * URL, so this also checks Origin/Host before touching any state.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "Cross-origin request rejected" }, { status: 403 });
  }

  const { token } = await params;
  const user = await getCurrentUser(request);
  const result = await resolveClaim(token, user?.userId ?? null);

  switch (result.status) {
    case "unauthenticated":
      return NextResponse.json({ error: "Sign in to claim this receipt" }, { status: 401 });
    case "not_found":
      return NextResponse.json({ error: "Claim token not found" }, { status: 404 });
    case "expired":
      return NextResponse.json({ error: "Claim token expired" }, { status: 410 });
    case "already_claimed":
      return NextResponse.json(
        { error: "Claim token already used" },
        { status: 409 }
      );
    case "claimed":
      return NextResponse.json(result.receipt);
  }
}
