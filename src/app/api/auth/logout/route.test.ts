import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { SESSION_COOKIE_NAME } from "@/lib/session";
import { POST as registerPost } from "../register/route";
import { GET as mePost } from "../me/route";
import { POST } from "./route";

function uniqueUsername(): string {
  return `user_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

async function registerAndGetToken(): Promise<string> {
  const response = await registerPost(
    new NextRequest("http://localhost/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ username: uniqueUsername(), password: "correct horse battery staple" }),
      headers: { "content-type": "application/json" },
    }),
  );
  return response.cookies.get(SESSION_COOKIE_NAME)!.value;
}

function logoutRequest(token: string): NextRequest {
  return new NextRequest("http://localhost/api/auth/logout", {
    method: "POST",
    headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
  });
}

describe("POST /api/auth/logout", () => {
  it("revokes the session so it can no longer authenticate", async () => {
    const token = await registerAndGetToken();

    const logoutResponse = await POST(logoutRequest(token));
    expect(logoutResponse.status).toBe(204);

    const meResponse = await mePost(
      new NextRequest("http://localhost/api/auth/me", { headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` } }),
    );
    expect(meResponse.status).toBe(401);
  });

  it("clears the session cookie (maxAge 0)", async () => {
    const token = await registerAndGetToken();
    const response = await POST(logoutRequest(token));
    expect(response.cookies.get(SESSION_COOKIE_NAME)?.value).toBe("");
  });

  it("succeeds even with no session cookie present", async () => {
    const response = await POST(new NextRequest("http://localhost/api/auth/logout", { method: "POST" }));
    expect(response.status).toBe(204);
  });
});
