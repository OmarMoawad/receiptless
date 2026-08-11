import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { SESSION_COOKIE_NAME } from "@/lib/session";
import { POST as registerPost } from "../register/route";
import { GET } from "./route";

function uniqueUsername(): string {
  return `user_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

async function registerAndGetToken(): Promise<{ username: string; token: string }> {
  const username = uniqueUsername();
  const response = await registerPost(
    new NextRequest("http://localhost/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ username, password: "correct horse battery staple" }),
      headers: { "content-type": "application/json" },
    }),
  );
  return { username, token: response.cookies.get(SESSION_COOKIE_NAME)!.value };
}

function meRequest(token?: string): NextRequest {
  return new NextRequest("http://localhost/api/auth/me", {
    headers: token ? { cookie: `${SESSION_COOKIE_NAME}=${token}` } : {},
  });
}

describe("GET /api/auth/me", () => {
  it("returns the current user for a valid session cookie", async () => {
    const { username, token } = await registerAndGetToken();

    const response = await GET(meRequest(token));
    expect(response.status).toBe(200);
    expect((await response.json()).username).toBe(username);
  });

  it("rejects a missing session cookie", async () => {
    const response = await GET(meRequest());
    expect(response.status).toBe(401);
  });

  it("rejects an invalid session cookie", async () => {
    const response = await GET(meRequest("not-a-real-token"));
    expect(response.status).toBe(401);
  });
});
