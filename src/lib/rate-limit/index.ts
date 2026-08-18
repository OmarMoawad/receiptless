import { createHash } from "node:crypto";
import { type NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE_NAME } from "@/lib/session";
import { isRateLimitEnforced, type PolicyName, RATE_LIMIT_POLICIES, type SubjectKind } from "./policy";
import { countRequest, pruneExpiredCounters } from "./store";

export { RATE_LIMIT_POLICIES, isRateLimitEnforced } from "./policy";
export type { PolicyName } from "./policy";
export { countRequest, pruneExpiredCounters } from "./store";

/**
 * The session cookie is hashed before it is ever used as a counter
 * subject: `RateLimitCounter` would otherwise hold live session tokens in
 * a column nothing treats as secret, which is the same mistake
 * `session.ts` already refuses to make by storing only a hash. Truncated
 * because a counter key needs to be unique, not collision-proof against
 * someone who already holds the token.
 */
function hashed(value: string): string {
  return createHash("sha256").update(value).digest("base64url").slice(0, 32);
}

/**
 * On Vercel, `x-forwarded-for` is set by the platform and its first entry
 * is the real client. **Locally it is absent**, so every request shares
 * the `unknown` subject — which is correct behaviour for a single-user
 * dev box and would be wrong in production if this app were ever put
 * behind a proxy that does not set the header. That is a deployment
 * property, so it is written down in DEPLOYMENT.md rather than guessed
 * at here.
 */
export function clientIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

function resolveSubject(kind: SubjectKind, request: NextRequest, username?: string): string | null {
  switch (kind) {
    case "ip":
      return `ip:${clientIp(request)}`;
    case "session": {
      const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
      // An unauthenticated caller on a session-keyed bucket is still
      // counted, by IP. "No session" must not be the way to opt out.
      return token ? `session:${hashed(token)}` : `ip:${clientIp(request)}`;
    }
    case "username": {
      const normalized = username?.trim().toLowerCase();
      // No username means the route will reject the body anyway, and the
      // IP limit on the same route has already counted the attempt.
      return normalized ? `username:${normalized}` : null;
    }
  }
}

/**
 * Housekeeping, deliberately not awaited and never allowed to fail a
 * request: at most one prune per instance per interval. Vercel recycles
 * instances freely, so this is opportunistic by design — a scheduled job
 * would be better and needs a Vercel cron, which is noted in
 * RECEIPTLESS_STATE.md rather than pretended to exist.
 */
const PRUNE_INTERVAL_MS = 60 * 60 * 1000;
let lastPruneAt = 0;

function maybePrune(): void {
  const now = Date.now();
  if (now - lastPruneAt < PRUNE_INTERVAL_MS) return;
  lastPruneAt = now;
  void pruneExpiredCounters().catch(() => {
    // A full counters table is a size problem, never a reason to fail a
    // user's request. Sentry already reports anything that throws on the
    // request path; this one is deliberately swallowed.
  });
}

/**
 * Applies every named policy and returns a `429` response as soon as one
 * refuses, or `null` when the request may proceed.
 *
 * Returning a response rather than throwing keeps the call site honest —
 * `if (limited) return limited;` is one line at the top of a handler, and
 * `rate-limit-coverage.test.ts` asserts that every mutating API route has
 * it. Next.js middleware would have been the single choke point, the way
 * IDent uses one Fastify hook, but middleware runs on the edge runtime
 * where Prisma cannot follow. The coverage test is what replaces it.
 */
export async function enforceRateLimit(
  request: NextRequest,
  policyNames: readonly PolicyName[],
  options: { username?: string } = {},
): Promise<NextResponse | null> {
  if (!isRateLimitEnforced()) return null;

  maybePrune();

  for (const name of policyNames) {
    const policy = RATE_LIMIT_POLICIES[name];
    const subject = resolveSubject(policy.subject, request, options.username);
    if (!subject) continue;

    const verdict = await countRequest(policy, subject);
    if (verdict.allowed) continue;

    /**
     * A refusal says how long to wait and nothing else — not which limit
     * fired, not how many attempts remain. On `auth-login-username` that
     * would confirm to someone probing that a username exists.
     */
    return NextResponse.json(
      { error: "Too many requests. Try again later." },
      { status: 429, headers: { "retry-after": String(verdict.retryAfterSeconds) } },
    );
  }

  return null;
}
