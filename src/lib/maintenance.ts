import { prisma } from "@/lib/db";
import { pruneExpiredCounters } from "@/lib/rate-limit";

/**
 * External review finding #14: every login writes a `Session` row and
 * nothing ever deletes one. Functionally fine — `findActiveSessionByTokenHash`
 * filters on expiry and revocation, so a stale row authenticates nobody —
 * but the table grows without bound, and RECEIPTLESS_STATE.md had already
 * logged it as "worth adding once this sees real traffic" before the
 * review raised it independently. Two independent findings is enough.
 *
 * Deliberately **only** the deletion half. The review also noted there is
 * no concurrent-session cap and no "log out other devices"; both are
 * product decisions (unlimited devices? a cap? an active-sessions page?)
 * and remain Omar's, logged in RECEIPTLESS_STATE.md's open decisions.
 * Deleting rows nobody can authenticate with needs no such decision.
 */

/**
 * How long a dead session row is kept after it stops being usable.
 *
 * Not zero: the first question after "did someone get into my account?"
 * is when sessions were created and revoked, and a table that deletes on
 * expiry has already thrown that away. Not forever: this is the growth
 * the finding is about. A week covers an incident noticed over a weekend.
 */
export const DEAD_SESSION_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * How long a rate-limit counter row is kept after its window ends. Longer
 * than any window in `rate-limit/policy.ts` (the longest is an hour), so
 * this never deletes a row that is still counting.
 */
export const COUNTER_RETENTION_SECONDS = 24 * 60 * 60;

export type MaintenanceResult = {
  sessionsDeleted: number;
  rateLimitCountersDeleted: number;
};

/**
 * Everything periodic, in one place, so there is one thing to schedule
 * and one thing to check rather than a cron per table.
 */
export async function runMaintenance(now: Date = new Date()): Promise<MaintenanceResult> {
  const cutoff = new Date(now.getTime() - DEAD_SESSION_RETENTION_MS);

  const sessions = await prisma.session.deleteMany({
    where: {
      OR: [
        // Expired long enough ago that nobody is diagnosing it any more.
        { expiresAt: { lt: cutoff } },
        // Revoked (logout) — same reasoning, measured from the revocation.
        { revokedAt: { lt: cutoff } },
      ],
    },
  });

  const counters = await pruneExpiredCounters(COUNTER_RETENTION_SECONDS);

  return { sessionsDeleted: sessions.count, rateLimitCountersDeleted: counters };
}
