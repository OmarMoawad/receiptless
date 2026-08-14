/**
 * Session 10 Part B — error tracking.
 *
 * Session 10's exit criteria name observability explicitly: "error
 * tracking and a log drain, so a production failure is visible without
 * SSH". This module is the error-tracking half; the log drain is a Vercel
 * project setting, not code (see DEPLOYMENT.md).
 *
 * **The scrubbing here is the important part, not the wiring.** This
 * application handles receipts — merchant names, line items, totals, and
 * the email addresses they arrived at. That is a purchase history, which
 * is exactly the sort of thing that must not be duplicated into a
 * third-party error tracker as a side effect of a stack trace. Sentry's
 * defaults capture request bodies, query strings, cookies and headers;
 * none of that is acceptable here unfiltered.
 *
 * So the posture is deny-by-default: strip everything that could carry
 * user data, and keep only what identifies *where* the code failed.
 */
import type { ErrorEvent, EventHint } from "@sentry/nextjs";

/**
 * Header allowlist. Everything else is dropped — an allowlist rather than
 * a blocklist because the failure mode of forgetting to block a header is
 * silent exfiltration, while the failure mode of forgetting to allow one
 * is a slightly less informative error report.
 */
const ALLOWED_HEADERS = new Set(["user-agent", "content-type", "accept"]);

/**
 * Strips the query string down to key names, discarding every value.
 *
 * Keeping key *names* is genuinely useful for debugging ("this failed
 * when `q` was present") and carries nothing about the user. Keeping
 * values would leak search terms — which for this product are things
 * people bought.
 */
export function redactUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl, "http://placeholder.invalid");
    const keys = [...url.searchParams.keys()];
    url.search = "";
    const suffix = keys.length > 0 ? `?${keys.map((key) => `${key}=<redacted>`).join("&")}` : "";
    return rawUrl.startsWith("http") ? `${url.origin}${url.pathname}${suffix}` : `${url.pathname}${suffix}`;
  } catch {
    // Defensive only, and rarely reached: parsing against a base URL means
    // almost any string resolves as a relative path rather than throwing.
    // That is the intended behaviour — the path is kept, the query values
    // are not — and this branch exists for the inputs `new URL` still
    // rejects outright.
    return "<unparseable-url>";
  }
}

/**
 * The `beforeSend` hook. Exported and pure so it can be tested directly —
 * a scrubber nobody exercises is a scrubber that quietly stops working.
 */
export function scrubEvent(event: ErrorEvent, _hint?: EventHint): ErrorEvent | null {
  // Request data: the single largest source of accidental disclosure.
  if (event.request) {
    // Bodies can contain an entire receipt, or a password on the auth
    // routes. There is no version of this we want off-machine.
    delete event.request.data;
    delete event.request.cookies;

    if (typeof event.request.url === "string") {
      event.request.url = redactUrl(event.request.url);
    }
    if (typeof event.request.query_string === "string") {
      const keys = new URLSearchParams(event.request.query_string).keys();
      event.request.query_string = [...keys].map((key) => `${key}=<redacted>`).join("&");
    }

    if (event.request.headers) {
      const headers: Record<string, string> = {};
      for (const [name, value] of Object.entries(event.request.headers)) {
        if (ALLOWED_HEADERS.has(name.toLowerCase()) && typeof value === "string") {
          headers[name] = value;
        }
      }
      event.request.headers = headers;
    }
  }

  // A username is a user identifier we chose; an email or IP is not
  // something we need in an error tracker to fix a bug.
  if (event.user) {
    event.user = event.user.id ? { id: event.user.id } : {};
  }

  // Breadcrumbs replay recent activity and routinely carry URLs and
  // payloads from fetches the app made.
  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs.map((crumb) => ({
      ...crumb,
      data: crumb.data?.url ? { url: redactUrl(String(crumb.data.url)) } : undefined,
      message: crumb.message ? redactUrl(crumb.message) : undefined,
    }));
  }

  return event;
}

/**
 * Whether error tracking should be active at all.
 *
 * Off without a DSN, and off outside a deployed environment: local
 * development should not post to a shared error tracker, and a test run
 * certainly should not.
 */
export function sentryEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const dsn = env.SENTRY_DSN?.trim() || env.NEXT_PUBLIC_SENTRY_DSN?.trim();
  if (!dsn) return false;
  if (env.NODE_ENV === "test") return false;
  return Boolean(env.VERCEL_ENV) || env.NODE_ENV === "production";
}

export function sentryDsn(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env.SENTRY_DSN?.trim() || env.NEXT_PUBLIC_SENTRY_DSN?.trim() || undefined;
}

/**
 * Shared init options. `sendDefaultPii` is explicitly false — it is the
 * master switch for the behaviour this whole module exists to prevent, and
 * it is stated here rather than left to a default that could change.
 */
export function sentryOptions(env: NodeJS.ProcessEnv = process.env) {
  return {
    dsn: sentryDsn(env),
    enabled: sentryEnabled(env),
    sendDefaultPii: false,
    // Deployment identity, so an error can be traced to a commit without
    // carrying anything about who hit it.
    environment: env.VERCEL_ENV || env.NODE_ENV || "development",
    release: env.VERCEL_GIT_COMMIT_SHA,
    tracesSampleRate: 0,
    beforeSend: scrubEvent,
  };
}
