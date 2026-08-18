import { after } from "next/server";

/**
 * The free half of a log drain.
 *
 * Vercel's drain streams the *platform's* logs — including the ones your
 * code never gets to write, because the function was killed — to an
 * external sink. That is a Pro feature and there is no way around it.
 * What is not gated is shipping the logs the application itself can
 * observe, which is most of what a drain is used for day to day:
 * ingestion outcomes, scan results, refused requests, scheduled jobs.
 *
 * So this covers the observable half, and DEPLOYMENT.md is explicit that
 * it is a half. The complement is an **external** uptime monitor, which
 * sees the failures this cannot: a function that times out writes
 * nothing, so only something outside the process can report it.
 *
 * Deliberately provider-agnostic — an ingest URL and a bearer token —
 * because Axiom, Better Stack, Grafana Cloud and Datadog all accept
 * newline-delimited JSON over HTTPS, and picking one in code would mean
 * changing code to change vendor.
 */

/** Unset means logging is off. Local development stays quiet by default. */
const SINK_URL = () => process.env.LOG_SINK_URL?.trim();
const SINK_TOKEN = () => process.env.LOG_SINK_TOKEN?.trim();

/**
 * Two seconds. A log sink is never worth making a user wait, and a slow
 * or wedged sink must not turn into a slow application — the thing being
 * measured must not be degraded by the measuring.
 */
const SINK_TIMEOUT_MS = 2000;

export type LogEvent = {
  /** Dotted, stable, greppable: "scan.completed", "ingest.unparseable". */
  event: string;
  level?: "info" | "warn" | "error";
  [field: string]: unknown;
};

/**
 * **Never log these.** A log sink is a third-party system with its own
 * retention and its own breach surface, so a credential that reaches it
 * has to be treated as disclosed. This list is enforced rather than
 * trusted to reviewers, because "don't log secrets" is exactly the rule
 * that decays — the notification ingest token reached the request log in
 * IDent's session 20 the same way.
 */
const FORBIDDEN_FIELDS = new Set([
  "password",
  "token",
  "accessToken",
  "refreshToken",
  "sessionToken",
  "authorization",
  "cookie",
  "encryptedTokenData",
  "rawPayload",
  "retainedEmail",
  "text",
]);

export function redact(event: LogEvent): LogEvent {
  const safe: LogEvent = { event: event.event };
  for (const [key, value] of Object.entries(event)) {
    if (key === "event") continue;
    safe[key] = FORBIDDEN_FIELDS.has(key) ? "[redacted]" : value;
  }
  return safe;
}

async function send(payload: Record<string, unknown>): Promise<void> {
  const url = SINK_URL();
  if (!url) return;

  const headers: Record<string, string> = { "content-type": "application/x-ndjson" };
  const token = SINK_TOKEN();
  if (token) headers.authorization = `Bearer ${token}`;

  try {
    await fetch(url, {
      method: "POST",
      headers,
      body: `${JSON.stringify(payload)}\n`,
      signal: AbortSignal.timeout(SINK_TIMEOUT_MS),
    });
  } catch {
    // Swallowed on purpose. A telemetry failure must never become an
    // application failure, and there is nowhere useful to report it —
    // reporting it would use the thing that just failed.
  }
}

/**
 * Records one event. Returns immediately.
 *
 * The `after()` call is the part that makes this work on Vercel rather
 * than only appearing to: an un-awaited promise started during a request
 * is not guaranteed to run once the response has been sent — the instance
 * can be frozen — so fire-and-forget logging silently drops events under
 * exactly the load where you want them. `after()` schedules the work to
 * run after the response instead, which is both reliable and off the
 * user's critical path.
 *
 * Outside a request (a script, a test) `after()` throws, so the send is
 * awaited in the background instead.
 */
export function logEvent(event: LogEvent): void {
  if (!SINK_URL()) return;

  const payload = {
    ...redact(event),
    level: event.level ?? "info",
    at: new Date().toISOString(),
    env: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "unknown",
    // Ties a line to the exact deployment that wrote it, which is the
    // first question when a log looks wrong.
    sha: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "local",
  };

  try {
    after(() => send(payload));
  } catch {
    void send(payload);
  }
}

/**
 * Pings a heartbeat URL to say a scheduled job finished.
 *
 * This is the cheapest answer to "did the cron stop running?", which no
 * amount of application logging can tell you — a job that never starts
 * writes nothing at all. The monitor alerts on the *absence* of this
 * ping, so silence becomes a signal instead of an assumption.
 */
export async function pingHeartbeat(): Promise<void> {
  const url = process.env.HEARTBEAT_URL?.trim();
  if (!url) return;
  try {
    await fetch(url, { method: "GET", signal: AbortSignal.timeout(SINK_TIMEOUT_MS) });
  } catch {
    // Same reasoning as send(): the monitor noticing a missed ping is the
    // fallback, so a failed ping is not worth failing the job over.
  }
}
