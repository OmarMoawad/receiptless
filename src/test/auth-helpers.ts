import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { SESSION_COOKIE_NAME } from "@/lib/session";
import { POST as registerPost } from "@/app/api/auth/register/route";

export function uniqueUsername(): string {
  return `user_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

export async function registerTestUser(): Promise<{
  userId: string;
  username: string;
  token: string;
}> {
  const username = uniqueUsername();
  const response = await registerPost(
    new NextRequest("http://localhost/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ username, password: "correct horse battery staple" }),
      headers: { "content-type": "application/json" },
    }),
  );
  const body = await response.json();
  return { userId: body.id, username, token: response.cookies.get(SESSION_COOKIE_NAME)!.value };
}

export function cookieHeader(token?: string): Record<string, string> {
  return token ? { cookie: `${SESSION_COOKIE_NAME}=${token}` } : {};
}
