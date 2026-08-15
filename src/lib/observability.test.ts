import { describe, expect, it } from "vitest";
import type { ErrorEvent } from "@sentry/nextjs";
import { redactUrl, scrubEvent, sentryEnabled, sentryOptions } from "./observability";

const env = (values: Record<string, string> = {}) => values as unknown as NodeJS.ProcessEnv;

describe("redactUrl", () => {
  it("keeps the path and the parameter names, and drops every value", () => {
    // Names are useful for debugging; values are what people bought.
    expect(redactUrl("https://app.example/api/search?q=espresso%20machine&page=2")).toBe(
      "https://app.example/api/search?q=<redacted>&page=<redacted>",
    );
  });

  it("redacts an OAuth callback, which carries a live authorization code", () => {
    const redacted = redactUrl("https://app.example/api/email/connections/gmail/callback?code=4/0AX&state=abc");
    expect(redacted).not.toContain("4/0AX");
    expect(redacted).not.toContain("abc");
    expect(redacted).toContain("/api/email/connections/gmail/callback");
  });

  it("handles a path-only URL", () => {
    expect(redactUrl("/receipts?claim=secret-token")).toBe("/receipts?claim=<redacted>");
  });

  it("still strips query values from input that barely looks like a URL", () => {
    // Parsing against a base URL means odd input resolves as a path rather
    // than throwing. That is fine — the guarantee this function makes is
    // "no query *values* survive", not "only well-formed URLs are handled".
    expect(redactUrl("%%%not a url%%%?q=espresso")).not.toContain("espresso");
    expect(redactUrl("%%%not a url%%%?q=espresso")).toContain("q=<redacted>");
  });
});

describe("scrubEvent", () => {
  const baseEvent = (): ErrorEvent =>
    ({
      request: {
        url: "https://app.example/api/receipts?q=coffee",
        query_string: "q=coffee&page=1",
        // A whole receipt, and on the auth routes a password.
        data: { merchant: "Kohl's", total: 48.2, items: ["Flat white"] },
        cookies: { session: "a-real-session-cookie" },
        headers: {
          "user-agent": "Mozilla/5.0",
          cookie: "session=a-real-session-cookie",
          authorization: "Bearer super-secret",
          "x-forwarded-for": "203.0.113.9",
        },
      },
      user: { id: "user-1", email: "omar@example.com", ip_address: "203.0.113.9", username: "omar" },
      breadcrumbs: [{ message: "GET /api/search?q=espresso", data: { url: "/api/search?q=espresso" } }],
    }) as unknown as ErrorEvent;

  it("removes the request body entirely", () => {
    // A receipt is purchase history; there is no version of it we want in
    // a third-party error tracker.
    const scrubbed = scrubEvent(baseEvent());
    expect(scrubbed?.request?.data).toBeUndefined();
  });

  it("removes cookies from both the cookies field and the headers", () => {
    const scrubbed = scrubEvent(baseEvent());
    expect(scrubbed?.request?.cookies).toBeUndefined();
    expect(scrubbed?.request?.headers).not.toHaveProperty("cookie");
  });

  it("drops the authorization header", () => {
    const scrubbed = scrubEvent(baseEvent());
    expect(scrubbed?.request?.headers).not.toHaveProperty("authorization");
  });

  it("allowlists headers rather than blocklisting them", () => {
    // The failure mode of a forgotten blocklist entry is silent
    // exfiltration; of a forgotten allowlist entry, a duller report.
    const scrubbed = scrubEvent(baseEvent());
    expect(Object.keys(scrubbed?.request?.headers ?? {})).toEqual(["user-agent"]);
    expect(scrubbed?.request?.headers).not.toHaveProperty("x-forwarded-for");
  });

  it("reduces the user to an opaque id, dropping email and IP", () => {
    const scrubbed = scrubEvent(baseEvent());
    expect(scrubbed?.user).toEqual({ id: "user-1" });
  });

  it("redacts query values in the url and query_string", () => {
    const scrubbed = scrubEvent(baseEvent());
    expect(scrubbed?.request?.url).not.toContain("coffee");
    expect(scrubbed?.request?.query_string).not.toContain("coffee");
    expect(scrubbed?.request?.query_string).toBe("q=<redacted>&page=<redacted>");
  });

  it("redacts breadcrumb urls and messages", () => {
    // Breadcrumbs replay recent activity and routinely carry search terms.
    const scrubbed = scrubEvent(baseEvent());
    expect(JSON.stringify(scrubbed?.breadcrumbs)).not.toContain("espresso");
  });

  it("survives an event with no request or user", () => {
    expect(scrubEvent({} as ErrorEvent)).toEqual({});
  });
});

describe("sentryEnabled", () => {
  it("is off without a DSN", () => {
    expect(sentryEnabled(env({ VERCEL_ENV: "production" }))).toBe(false);
  });

  it("is off in local development even with a DSN", () => {
    // A developer's stray error should not land in the shared tracker.
    expect(sentryEnabled(env({ SENTRY_DSN: "https://x@y/1", NODE_ENV: "development" }))).toBe(false);
  });

  it("is off under test", () => {
    expect(sentryEnabled(env({ SENTRY_DSN: "https://x@y/1", NODE_ENV: "test", VERCEL_ENV: "production" }))).toBe(false);
  });

  it("is on for a deployed environment with a DSN", () => {
    expect(sentryEnabled(env({ SENTRY_DSN: "https://x@y/1", VERCEL_ENV: "production" }))).toBe(true);
    expect(sentryEnabled(env({ NEXT_PUBLIC_SENTRY_DSN: "https://x@y/1", VERCEL_ENV: "preview" }))).toBe(true);
  });
});

describe("sentryOptions", () => {
  it("never sends default PII", () => {
    // The master switch for everything scrubEvent exists to prevent —
    // asserted rather than left to a library default that could change.
    expect(sentryOptions(env({ SENTRY_DSN: "https://x@y/1", VERCEL_ENV: "production" })).sendDefaultPii).toBe(false);
  });

  it("tags the release with the deployed commit", () => {
    const options = sentryOptions(env({ SENTRY_DSN: "https://x@y/1", VERCEL_ENV: "production", VERCEL_GIT_COMMIT_SHA: "abc123" }));
    expect(options.release).toBe("abc123");
    expect(options.environment).toBe("production");
  });
});
