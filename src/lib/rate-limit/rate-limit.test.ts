import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { POST as loginPost } from "@/app/api/auth/login/route";
import { POST as registerPost } from "@/app/api/auth/register/route";
import { GET as csvExportGet } from "@/app/api/export/csv/route";
import { GET as pdfExportGet } from "@/app/api/export/pdf/route";
import { cookieHeader, registerTestUser } from "@/test/auth-helpers";
import { clientIp, enforceRateLimit } from ".";
import { isRateLimitEnforced, RATE_LIMIT_POLICIES } from "./policy";
import { countRequest, pruneExpiredCounters } from "./store";

/**
 * Enforcement is off in the test environment by default (see policy.ts for
 * why), so this file switches it on for itself. Every case uses a subject
 * nothing else shares — a fresh bucket name, or a unique
 * `x-forwarded-for` — because the whole suite runs against one Postgres,
 * and a limiter test that leaks into a neighbouring file produces exactly
 * the load-shaped failure this repo has twice misread as a regression.
 */
beforeAll(() => {
  process.env.RATE_LIMIT_ENFORCE = "1";
});

afterAll(() => {
  delete process.env.RATE_LIMIT_ENFORCE;
});

function uniqueBucket(): string {
  return `test-${randomUUID()}`;
}

function ip(): string {
  return `10.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;
}

function postRequest(url: string, body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(url, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", ...headers },
  });
}

describe("the FX reconciliation policies", () => {
  it("limits preview like a report read and apply more strictly", () => {
    expect(RATE_LIMIT_POLICIES["fx-reconciliation-preview"]).toMatchObject({
      subject: "session",
      limit: 30,
      windowSeconds: 3600,
    });
    expect(RATE_LIMIT_POLICIES["fx-reconciliation-apply"]).toMatchObject({
      subject: "session",
      limit: 12,
      windowSeconds: 3600,
    });
  });
});

describe("the counter itself", () => {
  it("allows exactly `limit` requests, then refuses", async () => {
    const policy = { bucket: uniqueBucket(), subject: "ip" as const, limit: 3, windowSeconds: 60 };
    const verdicts = [];
    for (let i = 0; i < 4; i++) verdicts.push(await countRequest(policy, "subject-a"));

    expect(verdicts.map((v) => v.allowed)).toEqual([true, true, true, false]);
    expect(verdicts.map((v) => v.count)).toEqual([1, 2, 3, 4]);
  });

  it("keeps subjects independent, so one caller cannot throttle another", async () => {
    const policy = { bucket: uniqueBucket(), subject: "ip" as const, limit: 1, windowSeconds: 60 };
    expect((await countRequest(policy, "caller-1")).allowed).toBe(true);
    expect((await countRequest(policy, "caller-1")).allowed).toBe(false);
    expect((await countRequest(policy, "caller-2")).allowed).toBe(true);
  });

  it("starts a new window once the old one has expired", async () => {
    const bucket = uniqueBucket();
    const policy = { bucket, subject: "ip" as const, limit: 1, windowSeconds: 60 };
    await countRequest(policy, "subject");
    expect((await countRequest(policy, "subject")).allowed).toBe(false);

    // Age the window rather than sleeping through it.
    await prisma.$executeRaw`
      UPDATE "RateLimitCounter" SET "windowStart" = now() - interval '61 seconds'
      WHERE "bucket" = ${bucket} AND "subject" = 'subject'`;

    const afterReset = await countRequest(policy, "subject");
    expect(afterReset.allowed).toBe(true);
    expect(afterReset.count).toBe(1);
  });

  it("does not let a refused request push the window further out", async () => {
    const policy = { bucket: uniqueBucket(), subject: "ip" as const, limit: 1, windowSeconds: 60 };
    await countRequest(policy, "subject");
    const first = await countRequest(policy, "subject");
    const second = await countRequest(policy, "subject");
    expect(second.retryAfterSeconds).toBeLessThanOrEqual(first.retryAfterSeconds);
  });

  it("counts concurrent requests exactly once each — the flood case", async () => {
    const policy = { bucket: uniqueBucket(), subject: "ip" as const, limit: 5, windowSeconds: 60 };
    const verdicts = await Promise.all(Array.from({ length: 20 }, () => countRequest(policy, "concurrent")));

    expect(verdicts.filter((v) => v.allowed)).toHaveLength(5);
    expect(new Set(verdicts.map((v) => v.count)).size).toBe(20);
  });

  it("never advertises a zero-second Retry-After", async () => {
    const policy = { bucket: uniqueBucket(), subject: "ip" as const, limit: 0, windowSeconds: 1 };
    expect((await countRequest(policy, "s")).retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });
});

describe("prune", () => {
  it("deletes counters whose window ended long ago, and keeps live ones", async () => {
    const stale = uniqueBucket();
    const live = uniqueBucket();
    await countRequest({ bucket: stale, subject: "ip", limit: 1, windowSeconds: 60 }, "s");
    await countRequest({ bucket: live, subject: "ip", limit: 1, windowSeconds: 60 }, "s");
    await prisma.$executeRaw`
      UPDATE "RateLimitCounter" SET "windowStart" = now() - interval '3 days' WHERE "bucket" = ${stale}`;

    await pruneExpiredCounters(24 * 60 * 60);

    const remaining = await prisma.rateLimitCounter.findMany({ where: { bucket: { in: [stale, live] } } });
    expect(remaining.map((r) => r.bucket)).toEqual([live]);
  });
});

describe("subject resolution", () => {
  it("takes the first entry of x-forwarded-for, which is the real client on Vercel", () => {
    const request = postRequest("http://localhost/api/x", {}, { "x-forwarded-for": "203.0.113.7, 10.0.0.1" });
    expect(clientIp(request)).toBe("203.0.113.7");
  });

  it("stores a hash of the session cookie, never the cookie itself", async () => {
    const token = `session-token-${randomUUID()}`;
    const request = postRequest("http://localhost/api/x", {}, { cookie: `receiptless_session=${token}` });
    await enforceRateLimit(request, ["default-write"]);

    const leaked = await prisma.rateLimitCounter.findMany({ where: { subject: { contains: token } } });
    expect(leaked).toHaveLength(0);
  });

  it("counts an unauthenticated caller by IP rather than skipping the limit", async () => {
    const address = ip();
    const request = () => postRequest("http://localhost/api/x", {}, { "x-forwarded-for": address });
    await enforceRateLimit(request(), ["default-write"]);

    const counted = await prisma.rateLimitCounter.findFirst({
      where: { bucket: "default-write", subject: `ip:${address}` },
    });
    expect(counted?.count).toBe(1);
  });

  it("is enforced outside the test environment, and off inside it by default", () => {
    expect(isRateLimitEnforced({ NODE_ENV: "production" } as NodeJS.ProcessEnv)).toBe(true);
    expect(isRateLimitEnforced({ NODE_ENV: "development" } as NodeJS.ProcessEnv)).toBe(true);
    expect(isRateLimitEnforced({ NODE_ENV: "test" } as NodeJS.ProcessEnv)).toBe(false);
    expect(isRateLimitEnforced({ NODE_ENV: "test", RATE_LIMIT_ENFORCE: "1" } as NodeJS.ProcessEnv)).toBe(true);
  });
});

/**
 * Through the real route handlers, so these fail if a handler stops
 * calling the limiter — which is the failure the review actually found
 * (no route called anything).
 */
describe("over the real routes", () => {
  it(
    "throttles a full-vault export, which is a GET the mutating check never saw",
    async () => {
      // Session-scoped, so a freshly registered user is its own bucket
      // and this cannot collide with anything else in the suite.
      const owner = await registerTestUser();
      const limit = RATE_LIMIT_POLICIES["receipt-export"].limit;

      let last;
      for (let i = 0; i <= limit; i++) {
        last = await csvExportGet(
          new NextRequest("http://localhost/api/export/csv", { headers: cookieHeader(owner.token) }),
        );
        // Drain each body, or the refused request is racing open streams.
        if (last.status === 200) await last.text();
      }

      expect(last?.status).toBe(429);
      expect(Number(last?.headers.get("retry-after"))).toBeGreaterThan(0);

      // Both formats share one bucket: the cost being limited is the vault
      // walk, which is the same walk whichever file comes out of it.
      const pdf = await pdfExportGet(
        new NextRequest("http://localhost/api/export/pdf", { headers: cookieHeader(owner.token) }),
      );
      expect(pdf.status).toBe(429);
    },
    60_000,
  );

  it(
    "answers 429 with Retry-After once login attempts from one IP run out",
    async () => {
      const address = ip();
      const limit = RATE_LIMIT_POLICIES["auth-login-ip"].limit;
      let last;
      for (let i = 0; i <= limit; i++) {
        last = await loginPost(
          // A different username every attempt, so the per-username limit
          // is never the one that fires here.
          postRequest(
            "http://localhost/api/auth/login",
            { username: `nobody-${randomUUID().slice(0, 8)}`, password: "wrong password" },
            { "x-forwarded-for": address },
          ),
        );
      }

      expect(last?.status).toBe(429);
      expect(Number(last?.headers.get("retry-after"))).toBeGreaterThan(0);
      // The refusal says nothing about which limit fired or whether the
      // account exists.
      expect(await last?.json()).toEqual({ error: "Too many requests. Try again later." });
    },
    /**
     * The generous timeout is the finding, not an inconvenience: 21 failed
     * logins take seconds of real CPU because argon2 runs even for a
     * username that does not exist (deliberately — otherwise the response
     * time would say whether an account exists). That is exactly the
     * exhaustion vector review finding #4 named.
     */
    60_000,
  );

  it(
    "throttles one username across many IPs — the credential-stuffing shape",
    async () => {
      const username = `target-${randomUUID().slice(0, 8)}`;
      const limit = RATE_LIMIT_POLICIES["auth-login-username"].limit;
      let last;
      for (let i = 0; i <= limit; i++) {
        last = await loginPost(
          postRequest(
            "http://localhost/api/auth/login",
            { username, password: "wrong password" },
            { "x-forwarded-for": ip() }, // a fresh address every attempt
          ),
        );
      }

      expect(last?.status).toBe(429);
    },
    60_000,
  );

  it(
    "throttles registration, which is the other argon2 path",
    async () => {
      const address = ip();
      const limit = RATE_LIMIT_POLICIES["auth-register"].limit;
      let last;
      for (let i = 0; i <= limit; i++) {
        last = await registerPost(
          postRequest(
            "http://localhost/api/auth/register",
            { username: `reg_${randomUUID().replace(/-/g, "").slice(0, 12)}`, password: "correct horse battery" },
            { "x-forwarded-for": address },
          ),
        );
      }

      expect(last?.status).toBe(429);
    },
    60_000,
  );
});
