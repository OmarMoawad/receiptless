import type { NextRequest } from "next/server";
import { type AuthenticatedUser, validateSession } from "./auth-service";
import { SESSION_COOKIE_NAME } from "./session";

/**
 * The one place every session-gated route (this session's /api/auth/{me,
 * logout}, and Session 3's owner-scoped receipt routes) should read the
 * current user from — reads the cookie, validates it, returns null if
 * missing/invalid/expired/revoked. Mirrors IDent's identity/http.ts +
 * validateSession pattern, adapted from a bearer header to a cookie.
 */
export async function getCurrentUser(request: NextRequest): Promise<AuthenticatedUser | null> {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  return token ? validateSession(token) : null;
}

/**
 * Same as `getCurrentUser`, for Server Components (e.g. `/claim/[token]`'s
 * page) that read `next/headers()`'s cookie store instead of a
 * `NextRequest` — there's no request object available there.
 */
export async function getCurrentUserFromCookies(
  cookieStore: { get(name: string): { value: string } | undefined }
): Promise<AuthenticatedUser | null> {
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  return token ? validateSession(token) : null;
}
