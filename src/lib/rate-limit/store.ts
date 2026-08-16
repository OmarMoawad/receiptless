import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import type { RateLimitPolicy } from "./policy";

export type RateLimitVerdict = {
  allowed: boolean;
  /** Requests in the current window, including this one. */
  count: number;
  /** Seconds until the window resets. Sent as `Retry-After` on a refusal. */
  retryAfterSeconds: number;
};

/**
 * Counts one request against a window, and says whether it is allowed.
 *
 * The whole thing is **one statement** on purpose. A read-then-write
 * would race: two requests arriving together would both read a count
 * under the limit and both write limit+1 — and that concurrency is
 * exactly what a flood produces, so a limiter with that race is weakest
 * precisely when it matters. `INSERT ... ON CONFLICT DO UPDATE ...
 * RETURNING` takes a row lock and returns the post-increment value, so N
 * concurrent requests get N distinct counts with no transaction handling
 * here. There is a test that fires 20 at a limit of 5.
 *
 * The window resets inside the same statement rather than by a separate
 * expiry pass, so nothing has to delete rows on time for the limiter to
 * be correct — `pruneExpiredCounters` is about table size, not
 * correctness.
 *
 * An over-limit request still increments the count but does **not** move
 * `windowStart`, so hammering a limit cannot extend the block.
 */
export async function countRequest(policy: RateLimitPolicy, subject: string): Promise<RateLimitVerdict> {
  const rows = await prisma.$queryRaw<{ count: number; retry_after_seconds: number }[]>(Prisma.sql`
    INSERT INTO "RateLimitCounter" ("bucket", "subject", "windowStart", "count")
    VALUES (${policy.bucket}, ${subject}, now(), 1)
    ON CONFLICT ("bucket", "subject") DO UPDATE SET
      "count" = CASE
        WHEN "RateLimitCounter"."windowStart" <= now() - make_interval(secs => ${policy.windowSeconds}::double precision)
        THEN 1
        ELSE "RateLimitCounter"."count" + 1
      END,
      "windowStart" = CASE
        WHEN "RateLimitCounter"."windowStart" <= now() - make_interval(secs => ${policy.windowSeconds}::double precision)
        THEN now()
        ELSE "RateLimitCounter"."windowStart"
      END
    RETURNING
      "count",
      CEIL(EXTRACT(EPOCH FROM ("windowStart" + make_interval(secs => ${policy.windowSeconds}::double precision)) - now()))::int
        AS retry_after_seconds
  `);

  const row = rows[0];
  return {
    allowed: row.count <= policy.limit,
    count: Number(row.count),
    // Never advertise 0: a client that honours Retry-After literally
    // would retry straight back into the same refusal.
    retryAfterSeconds: Math.max(1, Number(row.retry_after_seconds)),
  };
}

/**
 * Deletes counters whose window ended long ago.
 *
 * Housekeeping rather than correctness — but "distinct subject" includes
 * every IP that ever reached the app, and the same review raised
 * unbounded growth of the `Session` table as finding #14. Introducing a
 * second table with the same problem, in the session that acts on that
 * review, would be a poor joke.
 */
export async function pruneExpiredCounters(olderThanSeconds = 24 * 60 * 60): Promise<number> {
  return prisma.$executeRaw(Prisma.sql`
    DELETE FROM "RateLimitCounter"
    WHERE "windowStart" < now() - make_interval(secs => ${olderThanSeconds}::double precision)
  `);
}
