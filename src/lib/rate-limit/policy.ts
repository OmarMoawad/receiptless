/**
 * External review (2026-08-15), findings #4 and #5: **no rate limiting on
 * login or registration.** Password guessing and argon2 resource
 * exhaustion were both open — argon2 is deliberately expensive, so an
 * unthrottled login endpoint spends our CPU on the attacker's cheapest
 * request.
 *
 * The same finding was raised against IDent, and the review asked for
 * **one approach across both repos**. What is shared is the design, not
 * the code (different stacks, different ORMs): a fixed-window counter in
 * Postgres, incremented by a single atomic statement, keyed by
 * `(bucket, subject)`; the same bucket names; the same limits; the same
 * 429 + `Retry-After` shape. IDent's copy is `apps/api/src/rate-limit/`.
 *
 * Postgres rather than an in-memory counter is not a preference here —
 * this app runs on Vercel, where consecutive requests can land on
 * different instances, so a per-process counter would limit nothing.
 *
 * Fixed-window rather than a sliding log: one row, one statement. Its
 * known weakness is up to 2x the limit across a window boundary, which
 * does not matter for a brake. It would matter if a limit were a billing
 * boundary.
 */
export type SubjectKind =
  /** Client IP. The only option before a session exists. */
  | "ip"
  /** A hash of the session cookie, falling back to IP when absent. */
  | "session"
  /** The username from the request body — see the note on login below. */
  | "username";

export type RateLimitPolicy = {
  bucket: string;
  subject: SubjectKind;
  /** Requests permitted per window. The (limit + 1)th is refused. */
  limit: number;
  windowSeconds: number;
};

const MINUTE = 60;
const HOUR = 60 * 60;

/**
 * Login is limited **twice**, and the second limit is the one that
 * matters. Per-IP alone stops one machine grinding one account; it does
 * nothing against a spread-out attempt on a single account from many
 * addresses, which is the shape credential stuffing actually takes.
 *
 * The cost, stated rather than hidden: a per-username limit lets a third
 * party lock a known username out of login for the window by spending
 * failures against it. It is per-window rather than cumulative, and set
 * high enough that a real user fumbling a password is unaffected.
 * Receiptless has no passkey path yet, so unlike IDent there is no second
 * way in during that window — worth knowing before the number is lowered.
 */
export const RATE_LIMIT_POLICIES = {
  "auth-login-ip": { bucket: "auth-login-ip", subject: "ip", limit: 20, windowSeconds: 15 * MINUTE },
  "auth-login-username": { bucket: "auth-login-username", subject: "username", limit: 8, windowSeconds: 15 * MINUTE },
  "auth-register": { bucket: "auth-register", subject: "ip", limit: 10, windowSeconds: HOUR },
  /** Cheap and session-bound, but still a write; a loop should not spin here. */
  "auth-logout": { bucket: "auth-logout", subject: "session", limit: 60, windowSeconds: HOUR },
  /** Each scan is a burst of Gmail API calls, so this bounds our egress too. */
  "provider-sync": { bucket: "provider-sync", subject: "session", limit: 12, windowSeconds: 5 * MINUTE },
  /** OCR is the most expensive thing a logged-in user can ask for. */
  "receipt-ocr": { bucket: "receipt-ocr", subject: "session", limit: 30, windowSeconds: HOUR },
  /**
   * A full-vault export. Cheaper per request than OCR in money, dearer in
   * work: both formats walk every receipt and every item the caller owns,
   * and the PDF renders a page per receipt on top of that. Session-scoped
   * because the cost is proportional to one vault, and set below
   * `receipt-ocr` because a person exports their archive a handful of
   * times a day, not thirty.
   */
  "receipt-export": { bucket: "receipt-export", subject: "session", limit: 12, windowSeconds: HOUR },
  /** Receipt create/upload: generous for a person, bounded for a script. */
  "receipt-write": { bucket: "receipt-write", subject: "session", limit: 120, windowSeconds: HOUR },
  /**
   * FX reconciliation preview reads and classifies a whole vault but writes
   * nothing and calls no provider, so it is limited like a report read: a
   * person previews a handful of times while deciding, not thousands.
   */
  "fx-reconciliation-preview": {
    bucket: "fx-reconciliation-preview",
    subject: "session",
    limit: 30,
    windowSeconds: HOUR,
  },
  /**
   * Apply is stricter than preview because a single batch can trigger
   * external rate retrieval and writes conversion rows. Twelve batches an
   * hour is enough to walk a large vault ten receipts at a time in one
   * sitting, and low enough that a runaway client cannot hammer the
   * provider through it.
   */
  "fx-reconciliation-apply": {
    bucket: "fx-reconciliation-apply",
    subject: "session",
    limit: 12,
    windowSeconds: HOUR,
  },
  /**
   * Claim attach reassigns ownership from a URL, so an unthrottled
   * endpoint is a token-guessing oracle as well as a write path.
   */
  "claim": { bucket: "claim", subject: "ip", limit: 60, windowSeconds: HOUR },
  /**
   * The unauthenticated merchant endpoint. It is already off by default
   * anywhere the internet can reach it (deployment.ts) — this is the
   * limit for the environments where it is deliberately on.
   */
  "merchant-api": { bucket: "merchant-api", subject: "ip", limit: 120, windowSeconds: MINUTE },
  /**
   * Inbound email webhook. Postmark is a machine sender behind Basic auth,
   * so the ceiling is high enough that a real mail burst passes and low
   * enough that a runaway sender cannot fill the receipts table.
   */
  "inbound-email": { bucket: "inbound-email", subject: "ip", limit: 300, windowSeconds: MINUTE },
  /**
   * Phase 3 Session 1: authenticated merchant-dashboard writes (create an
   * account, add/remove members, create/update locations). Session-scoped
   * because the work is bounded to one account owner, and generous enough
   * for real onboarding while stopping a script from spraying accounts or
   * membership churn.
   */
  "merchant-admin": { bucket: "merchant-admin", subject: "session", limit: 120, windowSeconds: MINUTE },
  /**
   * The catch-all for authenticated writes with no reason to be tighter
   * (starting or disconnecting a provider connection today). It exists so
   * that "which limit does this route get?" always has an answer, and a
   * route added later is throttled the day it is written. Same name and
   * numbers as IDent's.
   */
  "default-write": { bucket: "default-write", subject: "session", limit: 120, windowSeconds: MINUTE },
} as const satisfies Record<string, RateLimitPolicy>;

export type PolicyName = keyof typeof RATE_LIMIT_POLICIES;

/**
 * Enforcement is **on everywhere except the test suite**, where it is off
 * unless a test asks for it.
 *
 * That exception is a real weakening and is worth being plain about: the
 * ordinary route tests prove nothing about throttling. The alternative
 * was worse — every test file shares one Postgres and every request in a
 * test carries no client IP at all, so a suite-wide limit would make
 * unrelated tests fail each other in exactly the way this repo has twice
 * misdiagnosed as a regression (RECEIPTLESS_STATE.md's flake notes).
 * rate-limit.test.ts sets RATE_LIMIT_ENFORCE=1 and uses distinct
 * subjects, so the enforced path is covered on purpose.
 */
export function isRateLimitEnforced(env: NodeJS.ProcessEnv = process.env): boolean {
  const flag = env.RATE_LIMIT_ENFORCE?.trim().toLowerCase();
  if (flag === "1" || flag === "true") return true;
  if (flag === "0" || flag === "false") return false;
  return env.NODE_ENV !== "test";
}
