/**
 * Session 10 Part B — refuse to run the test suite against a remote
 * database.
 *
 * This suite is destructive by design: it creates and deletes users,
 * receipts and sessions against a real Postgres (see README — no mocked
 * DB). That is fine when `DATABASE_URL` points at the local container
 * from `docker-compose.yml`. It is a catastrophe if it points anywhere
 * else.
 *
 * Until Session 10 there was no "anywhere else" to point at, so nothing
 * needed guarding. Introducing a hosted database changes that, and the
 * specific way it goes wrong is mundane: Neon's own onboarding suggests
 * `npx neonctl@latest init`, which writes the production `DATABASE_URL`
 * into `.env`. One `npm test` later, the production database has been
 * truncated by the test suite. Nothing warns you, because from the
 * suite's point of view everything worked.
 *
 * So this fails loudly, before any test opens a connection.
 *
 * The check is a *hostname allowlist*, not a blocklist of known providers:
 * a blocklist would need updating for every new host, and the failure mode
 * of missing one is the disaster this file exists to prevent.
 */

/** Hosts that can only be this machine. */
const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0", "host.docker.internal"]);

export function assertLocalDatabase(env: NodeJS.ProcessEnv = process.env): void {
  const raw = env.DATABASE_URL?.trim();

  // No URL at all is a different problem, and one the tests themselves
  // report far more clearly than a guard would.
  if (!raw) return;

  // An explicit, deliberate override. Named so it cannot be set by
  // accident, and so a grep for it finds every place someone decided to
  // do this on purpose.
  if (env.ALLOW_NONLOCAL_TEST_DATABASE === "i-know-this-deletes-data") return;

  let hostname: string;
  try {
    hostname = new URL(raw).hostname.toLowerCase();
  } catch {
    throw new Error(
      `DATABASE_URL is not a parseable URL, so the test suite cannot confirm it is local. ` +
        `Refusing to run: this suite deletes data.`,
    );
  }

  if (LOCAL_HOSTNAMES.has(hostname)) return;

  throw new Error(
    [
      "",
      "  The test suite is pointed at a NON-LOCAL database and will not run.",
      "",
      `    DATABASE_URL host: ${hostname}`,
      "",
      "  This suite creates and deletes users, receipts and sessions. Running it",
      "  against a hosted database destroys real data.",
      "",
      "  Most likely cause: something rewrote .env with a production connection",
      "  string — `npx neonctl@latest init` does exactly this. Point DATABASE_URL",
      "  back at the local container from docker-compose.yml:",
      "",
      "    DATABASE_URL=\"postgresql://receiptless:receiptless@localhost:5433/receiptless\"",
      "",
      "  If you genuinely mean to run destructive tests against this host, set",
      "  ALLOW_NONLOCAL_TEST_DATABASE=i-know-this-deletes-data.",
      "",
    ].join("\n"),
  );
}

assertLocalDatabase();
