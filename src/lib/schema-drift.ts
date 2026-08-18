import { readdirSync } from "node:fs";
import path from "node:path";
import { prisma } from "./db";

/**
 * Does the database have every migration this build expects?
 *
 * **Written after production broke for half an hour on 2026-08-19 and
 * nothing noticed.** Three merged PRs deployed code that needed three new
 * tables and columns. Vercel deploys code but not schema — deliberately,
 * see DEPLOYMENT.md §4 — so the migrations had not run. Every login
 * returned 500, because login goes through the rate-limit table.
 *
 * Sentry saw the exceptions but nobody was watching it; `/api/health`
 * returned 200 the whole time because it only ran `SELECT 1`; the uptime
 * monitor was green for the same reason. The failure was found by trying
 * to log in.
 *
 * A health check that only proves the database is *reachable* cannot see
 * a database that is reachable and behind. This closes that.
 */

/**
 * Migration directory names in this build, which is the set the code was
 * compiled against. Read from disk rather than hard-coded so that adding
 * a migration needs no second edit here — a list someone must remember to
 * update is a list that will be wrong exactly when it matters.
 */
function expectedMigrations(): string[] | null {
  try {
    return readdirSync(path.join(process.cwd(), "prisma", "migrations"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch {
    // The folder is not bundled, or the runtime cannot read it. Reported
    // as "unknown" rather than as drift: a health check that cries wolf
    // gets muted, and a muted check is worse than none.
    return null;
  }
}

export type SchemaState =
  | { status: "ok"; pending: [] }
  | { status: "behind"; pending: string[] }
  | { status: "unknown"; pending: [] };

export async function checkSchemaState(): Promise<SchemaState> {
  const expected = expectedMigrations();
  if (!expected || expected.length === 0) return { status: "unknown", pending: [] };

  let applied: Set<string>;
  try {
    const rows = await prisma.$queryRaw<{ migration_name: string }[]>`
      SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL
    `;
    applied = new Set(rows.map((row) => row.migration_name));
  } catch {
    // No _prisma_migrations table at all, or the database is unreachable.
    // Reachability is already reported separately by the health endpoint.
    return { status: "unknown", pending: [] };
  }

  const pending = expected.filter((name) => !applied.has(name));
  return pending.length === 0 ? { status: "ok", pending: [] } : { status: "behind", pending };
}
