import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { SESSION_COOKIE_NAME } from "@/lib/session";
import { POST } from "./route";

function uniqueUsername(): string {
  return `user_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

function postRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/auth/register", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

describe("POST /api/auth/register", () => {
  it("creates a user and sets a session cookie", async () => {
    const username = uniqueUsername();
    const response = await POST(postRequest({ username, password: "correct horse battery staple" }));
    expect(response.status).toBe(201);

    const body = await response.json();
    expect(body.username).toBe(username);
    expect(typeof body.id).toBe("string");

    const cookie = response.cookies.get(SESSION_COOKIE_NAME);
    expect(cookie?.value).toBeTruthy();
    expect(cookie?.httpOnly).toBe(true);

    const stored = await prisma.user.findUnique({ where: { username } });
    expect(stored).not.toBeNull();
    expect(stored?.passwordHash).not.toBe("correct horse battery staple");
  });

  it("rejects a duplicate username with 409", async () => {
    const username = uniqueUsername();
    await POST(postRequest({ username, password: "correct horse battery staple" }));
    const response = await POST(postRequest({ username, password: "a different password" }));
    expect(response.status).toBe(409);
  });

  it("rejects invalid JSON with 400", async () => {
    const response = await POST(postRequest("not json"));
    expect(response.status).toBe(400);
  });

  it("rejects an invalid username with 400", async () => {
    const response = await POST(postRequest({ username: "AB", password: "correct horse battery staple" }));
    expect(response.status).toBe(400);
  });

  it("rejects a weak password with 400", async () => {
    const response = await POST(postRequest({ username: uniqueUsername(), password: "short" }));
    expect(response.status).toBe(400);
  });
});
