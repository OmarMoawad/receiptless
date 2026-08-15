import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { completeGmailConnection } from "@/lib/gmail-connection";
import { createConfiguredGmailApiClient } from "@/lib/gmail-api-client";

/**
 * Google's redirect back. Anonymous by construction — it carries no
 * session cookie of ours — so the single-use `state` is the only thing
 * tying it to the user who started the flow, and it is consumed exactly
 * once whether or not the rest succeeds.
 *
 * **Diagnosability (Session 10 slice).** This handler used to end in a
 * bare `catch { }` that discarded the error and redirected to a generic
 * failure. That is safe — nothing leaks to the user — but it made a real
 * failure impossible to diagnose: the first live Gmail connection failed
 * here and the application had thrown away the only evidence of why.
 *
 * The user still sees a generic message, because this endpoint is
 * anonymous and its details are not theirs to read. The *operator* now
 * gets the real error, in Sentry and in the platform log. Those are
 * different audiences and they should get different amounts of detail.
 */
export async function GET(request: NextRequest) {
  const apiClient = createConfiguredGmailApiClient();
  if (!apiClient) return NextResponse.redirect(new URL("/receipts?gmail=unconfigured", request.url));

  const state = request.nextUrl.searchParams.get("state");
  const code = request.nextUrl.searchParams.get("code");

  // Google reports its own refusals here rather than by not redirecting —
  // access_denied when the user declines, for one. Previously this
  // arrived as a bare "failed" indistinguishable from a server fault.
  const googleError = request.nextUrl.searchParams.get("error");
  if (googleError) {
    Sentry.captureMessage(`Gmail OAuth: Google returned error=${googleError}`, "warning");
    console.warn(`[gmail-oauth] Google returned error=${googleError}`);
    return NextResponse.redirect(new URL(`/receipts?gmail=denied`, request.url));
  }

  if (!state || !code) {
    console.warn(`[gmail-oauth] callback missing ${!state ? "state" : "code"}`);
    return NextResponse.redirect(new URL("/receipts?gmail=failed", request.url));
  }

  try {
    const result = await completeGmailConnection({ state, code }, apiClient);
    if (!result) {
      // A null result means the state was not found or was already
      // consumed — a replayed or expired link, not a fault. Distinguished
      // from a thrown error because the two need different advice, and
      // both used to render the same sentence.
      Sentry.captureMessage("Gmail OAuth: state not found or already consumed", "info");
      console.warn("[gmail-oauth] state not found or already consumed");
      return NextResponse.redirect(new URL("/receipts?gmail=expired", request.url));
    }
    return NextResponse.redirect(new URL("/receipts?gmail=connected", request.url));
  } catch (error) {
    // The operator gets the real thing. Token-exchange failures are the
    // interesting case: a wrong client secret, a redirect_uri that differs
    // between the authorize and token calls, or a PKCE mismatch all land
    // here and are otherwise invisible.
    Sentry.captureException(error, { tags: { flow: "gmail-oauth-callback" } });
    console.error("[gmail-oauth] token exchange failed:", error);
    return NextResponse.redirect(new URL("/receipts?gmail=failed", request.url));
  }
}
