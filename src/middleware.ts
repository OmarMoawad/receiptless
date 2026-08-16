import { type NextRequest, NextResponse } from "next/server";
import { isSameOrigin } from "@/lib/origin-check";

/**
 * External review (2026-08-15), finding #5: apply a **consistent**
 * trusted-origin policy across every mutating endpoint, rather than the
 * one-route-at-a-time version this repo had.
 *
 * Until now exactly three call sites checked the origin — the claim page,
 * its server action, and `/api/claim/[token]` — because session 3's claim
 * flow was the one that obviously reassigned ownership from a URL. Login,
 * registration, logout, receipt creation and upload, scan and disconnect
 * had nothing. The session cookie is `SameSite=Lax`, which does block
 * cross-site *form posts*, so this is defence in depth rather than a hole
 * standing wide open — but "the cookie attribute happens to cover it" is
 * a property of one cookie setting, checked nowhere, and a future
 * `SameSite=None` (or a browser that treats Lax differently) would remove
 * it silently. Checking it here makes it a property of the app.
 *
 * Middleware rather than a helper called from each route, so a route
 * added later is covered by default: the failure this replaces was
 * per-route drift, and a per-route fix would drift the same way.
 *
 * **Mutating methods only.** A GET must not be checked here: the Gmail
 * OAuth callback is a top-level redirect from accounts.google.com, so it
 * legitimately arrives with a cross-site `Referer`, and rejecting it
 * would break the connect flow every time. The claim *page* is a GET that
 * does need a check, and keeps its own — see origin-check.ts, which
 * explains why `SameSite=Lax` alone does not cover a top-level GET.
 *
 * Server-to-server callers (Postmark's webhook, a POS terminal calling
 * the merchant API) send no `Origin` and no `Referer`, and
 * `isSameOrigin` treats a request with neither as same-origin — so this
 * does not break them. Their protection is their own credential (Basic
 * auth, an env gate), which is the right control for a non-browser
 * caller; an origin check is only ever meaningful against a browser.
 */
const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function middleware(request: NextRequest) {
  if (!MUTATING_METHODS.has(request.method)) return NextResponse.next();
  if (isSameOrigin(request)) return NextResponse.next();

  return NextResponse.json({ error: "Cross-origin request rejected" }, { status: 403 });
}

export const config = {
  /**
   * Everything except Next's own internals and static files. The matcher
   * is an exclusion list rather than `/api/:path*` on purpose — Server
   * Actions post to page routes, not to `/api`, so an allowlist of API
   * paths would leave every action uncovered.
   */
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
