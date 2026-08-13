import { NextRequest, NextResponse } from "next/server";
import { completeGmailConnection } from "@/lib/gmail-connection";
import { createConfiguredGmailApiClient } from "@/lib/gmail-api-client";

/**
 * Google's redirect back. Anonymous by construction — it carries no
 * session cookie of ours — so the single-use `state` is the only thing
 * tying it to the user who started the flow, and it is consumed exactly
 * once whether or not the rest succeeds.
 */
export async function GET(request: NextRequest) {
  const apiClient = createConfiguredGmailApiClient();
  if (!apiClient) return NextResponse.redirect(new URL("/receipts?gmail=unconfigured", request.url));

  const state = request.nextUrl.searchParams.get("state");
  const code = request.nextUrl.searchParams.get("code");
  if (!state || !code) return NextResponse.redirect(new URL("/receipts?gmail=failed", request.url));

  try {
    const result = await completeGmailConnection({ state, code }, apiClient);
    if (!result) return NextResponse.redirect(new URL("/receipts?gmail=failed", request.url));
    return NextResponse.redirect(new URL("/receipts?gmail=connected", request.url));
  } catch {
    return NextResponse.redirect(new URL("/receipts?gmail=failed", request.url));
  }
}
