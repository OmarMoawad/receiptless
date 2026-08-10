import { NextRequest, NextResponse } from "next/server";
import { resolveClaim } from "@/lib/claim";

/**
 * Resolves a claim token from the QR claim-token protocol (see
 * merchant/receipts route and ROADMAP.md). The token is opaque and carries
 * no receipt data itself — this is the only place that data is fetched,
 * so it can be gated, expired, and rejected on replay instead of being
 * embedded in a scannable image forever. See src/lib/claim.ts for the
 * one-time-claim semantics.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const result = await resolveClaim(token);

  switch (result.status) {
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
