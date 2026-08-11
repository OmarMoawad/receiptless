import { createHash, randomBytes } from "node:crypto";

const TOKEN_BYTES = 32;

// The whole session lifetime — no refresh-token flow exists yet, matching
// IDent's identity/session.ts convention (see that file's comment).
export const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days
export const SESSION_COOKIE_NAME = "receiptless_session";

export function generateSessionToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

// Only this hash is ever persisted — the raw token set on the cookie at
// issuance can't be recovered from the sessions table, so a DB read alone
// can't impersonate a session.
export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}
