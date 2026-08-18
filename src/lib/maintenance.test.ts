import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { GET as cronGet } from "@/app/api/cron/maintenance/route";
import { DEAD_SESSION_RETENTION_MS, runMaintenance } from "./maintenance";
import { hashSessionToken } from "./session";

const DAY = 24 * 60 * 60 * 1000;

async function createUser(): Promise<string> {
  const user = await prisma.user.create({
    data: { username: `maint_${randomUUID().replace(/-/g, "").slice(0, 12)}`, passwordHash: "not-a-real-hash" },
  });
  return user.id;
}

async function createSession(
  userId: string,
  fields: { expiresAt: Date; revokedAt?: Date },
): Promise<string> {
  const session = await prisma.session.create({
    data: { userId, tokenHash: hashSessionToken(randomUUID()), ...fields },
  });
  return session.id;
}

function exists(id: string) {
  return prisma.session.findUnique({ where: { id } }).then(Boolean);
}

describe("session cleanup", () => {
  it("deletes sessions that expired long ago and keeps live ones", async () => {
    const userId = await createUser();
    const long_dead = await createSession(userId, { expiresAt: new Date(Date.now() - 30 * DAY) });
    const live = await createSession(userId, { expiresAt: new Date(Date.now() + 30 * DAY) });

    await runMaintenance();

    expect(await exists(long_dead)).toBe(false);
    expect(await exists(live)).toBe(true);
  });

  it("keeps a recently expired session, so an incident is still diagnosable", async () => {
    const userId = await createUser();
    // Expired an hour ago: unusable for authentication, but exactly the
    // row someone asking "when did that session end?" needs to see.
    const recent = await createSession(userId, { expiresAt: new Date(Date.now() - 60 * 60 * 1000) });

    await runMaintenance();

    expect(await exists(recent)).toBe(true);
  });

  it("deletes a session revoked long ago, measured from the revocation", async () => {
    const userId = await createUser();
    // Still inside its own expiry window — logout is what killed it.
    const revoked = await createSession(userId, {
      expiresAt: new Date(Date.now() + 30 * DAY),
      revokedAt: new Date(Date.now() - DEAD_SESSION_RETENTION_MS - DAY),
    });
    const recentlyRevoked = await createSession(userId, {
      expiresAt: new Date(Date.now() + 30 * DAY),
      revokedAt: new Date(),
    });

    await runMaintenance();

    expect(await exists(revoked)).toBe(false);
    expect(await exists(recentlyRevoked)).toBe(true);
  });

  it("reports what it deleted, so a scheduled run is checkable", async () => {
    const userId = await createUser();
    await createSession(userId, { expiresAt: new Date(Date.now() - 30 * DAY) });

    const result = await runMaintenance();
    expect(result.sessionsDeleted).toBeGreaterThanOrEqual(1);
    expect(typeof result.rateLimitCountersDeleted).toBe("number");
  });
});

describe("the cron endpoint", () => {
  function get(headers: Record<string, string> = {}): NextRequest {
    return new NextRequest("http://localhost/api/cron/maintenance", { method: "GET", headers });
  }

  it("runs locally without a secret, so the job is testable without deploying", async () => {
    const response = await cronGet(get());
    expect(response.status).toBe(200);
    expect((await response.json()).status).toBe("ok");
  });

  it("refuses a wrong secret", async () => {
    process.env.CRON_SECRET = "the-real-secret";
    try {
      expect((await cronGet(get({ authorization: "Bearer wrong" }))).status).toBe(404);
      expect((await cronGet(get())).status).toBe(404);
      expect((await cronGet(get({ authorization: "Bearer the-real-secret" }))).status).toBe(200);
    } finally {
      delete process.env.CRON_SECRET;
    }
  });

  it("fails closed in a deployed environment with no secret configured", async () => {
    // Otherwise this is an unauthenticated delete-rows button on the
    // public internet, reachable by anyone who guesses the path.
    process.env.VERCEL_ENV = "production";
    try {
      expect((await cronGet(get())).status).toBe(404);
    } finally {
      delete process.env.VERCEL_ENV;
    }
  });
});
