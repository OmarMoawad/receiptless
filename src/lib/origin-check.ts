import type { NextRequest } from "next/server";

type HeaderReader = { get(name: string): string | null };

/**
 * Best-effort same-origin check for mutating routes — CSRF defense-in-depth
 * on top of the `SameSite=Lax` session cookie (auth-cookie.ts), relevant
 * from Session 3 onward specifically because claim attach reassigns account
 * ownership from a URL (RECEIPTLESS_STATE.md), and `SameSite=Lax` alone
 * still allows the cookie on a top-level cross-site GET navigation (that's
 * the whole point of "Lax"). Browsers include `Origin` on any cross-site
 * request, GET navigations included (Fetch spec's same-site Origin rules),
 * but omit it on same-origin requests — so a *present and mismatched*
 * Origin is a reliable cross-site signal. Falls back to `Referer` when
 * `Origin` is absent (older/non-browser clients); if neither header nor an
 * expected origin is available, the request is treated as same-origin
 * rather than rejected. This is a same-site check, not a substitute for a
 * dedicated CSRF token — RECEIPTLESS_STATE.md notes a real token is
 * reasonable to add later for higher-risk actions, not required this
 * session.
 */
function checkOrigin(headers: HeaderReader, expected: string | null): boolean {
  if (!expected) return true;

  const origin = headers.get("origin");
  if (origin) return origin === expected;

  const referer = headers.get("referer");
  if (referer) {
    try {
      return new URL(referer).origin === expected;
    } catch {
      return false;
    }
  }

  return true;
}

export function isSameOrigin(request: NextRequest): boolean {
  return checkOrigin(request.headers, request.nextUrl.origin);
}

/**
 * Same check for Server Components/Actions reading from next/headers()`,
 * which has no `nextUrl` to derive the expected origin from — reconstructs
 * it from `Host` (+ `X-Forwarded-Proto` behind a proxy, defaulting to
 * `https` unless `Host` looks like a local dev address). Used by
 * `/claim/[token]`'s page, the primary claim-attach path in the actual app
 * (the `/api/claim/[token]` route exists for non-browser clients, e.g. the
 * `receiptless://` scheme).
 */
export function isSameOriginFromHeaders(headers: HeaderReader): boolean {
  const host = headers.get("host");
  if (!host) return true;

  const isLocal = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
  const protocol = headers.get("x-forwarded-proto") ?? (isLocal ? "http" : "https");
  return checkOrigin(headers, `${protocol}://${host}`);
}
