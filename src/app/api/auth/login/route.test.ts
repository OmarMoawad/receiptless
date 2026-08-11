import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { SESSION_COOKIE_NAME } from "@/lib/session";
import { POST as registerPost } from "../register/route";
import { POST } from "./route";

function uniqueUsername(): string {
  return `user_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

function postRequest(url: string, body: unknown): NextRequest {
  return new NextRequest(url, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

async function registerUser(username: string, password: string) {
  await registerPost(postRequest("http://localhost/api/auth/register", { username, password }));
}

describe("POST /api/auth/login", () => {
  it("logs in with correct credentials and sets a new session cookie", async () => {
    const username = uniqueUsername();
    const password = "correct horse battery staple";
    await registerUser(username, password);

    const response = await POST(postRequest("http://localhost/api/auth/login", { username, password }));
    expect(response.status).toBe(200);
    expect((await response.json()).username).toBe(username);
    expect(response.cookies.get(SESSION_COOKIE_NAME)?.value).toBeTruthy();
  });

  it("rejects a wrong password with 401", async () => {
    const username = uniqueUsername();
    await registerUser(username, "correct horse battery staple");

    const response = await POST(
      postRequest("http://localhost/api/auth/login", { username, password: "definitely-wrong" }),
    );
    expect(response.status).toBe(401);
  });

  it("rejects a username that doesn't exist with 401", async () => {
    const response = await POST(
      postRequest("http://localhost/api/auth/login", { username: uniqueUsername(), password: "irrelevant" }),
    );
    expect(response.status).toBe(401);
  });
});
