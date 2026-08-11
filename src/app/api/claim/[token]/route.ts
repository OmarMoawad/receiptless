import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { previewClaim, resolveClaim } from "@/lib/claim";
import { isSameOrigin } from "@/lib/origin-check";

/**
 * Read-only preview of a claim-token receipt — see src/lib/claim.ts's
 * `previewClaim`. Deliberately never mutates: GET must stay a safe method
 * (RFC 9110), so a link-preview bot, crawler, or browser prefetch can hit
 * this without consuming the token. Still requires a session, matching
 * the previous GET's auth gate — this doesn't change who can *see* a
 * receipt, only that seeing it no longer claims it.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "Sign in to view this receipt" }, { status: 401 });

  const result = await previewClaim(token);

  switch (result.status) {
    case "not_found":
      return NextResponse.json({ error: "Claim token not found" }, { status: 404 });
    case "expired":
      return NextResponse.json({ error: "Claim token expired" }, { status: 410 });
    case "already_claimed":
      return NextResponse.json({ error: "Claim token already used" }, { status: 409 });
    case "previewable":
      return NextResponse.json({ status: "previewable", receipt: result.receipt });
  }
}

/**
 * The only place a claim token is actually resolved and attached to an
 * account — see src/lib/claim.ts's `resolveClaim` for the atomic
 * claim+attach semantics. POST-only and Origin/Host-checked because this
 * reassigns account ownership from a URL: `SameSite=Lax` alone still lets
 * the session cookie ride along on a top-level cross-site GET
 * navigation, which is exactly why this can no longer be a GET at all.
 */
export async function POST(
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
