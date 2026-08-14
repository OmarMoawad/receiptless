import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { registerTestUser } from "@/test/auth-helpers";
import { POST } from "./route";

function auth(value = "webhook-user:webhook-password") {
  return `Basic ${Buffer.from(value).toString("base64")}`;
}

function request(body: unknown, authorization?: string) {
  return new NextRequest("http://localhost/api/webhooks/email/postmark", {
    method: "POST",
    headers: { "content-type": "application/json", ...(authorization ? { authorization } : {}) },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function payload(mailboxToken: string, messageId = randomUUID()) {
  return { MessageID: messageId, MailboxHash: mailboxToken, From: "shop@example.com", Subject: "Receipt", TextBody: "Shop\nTOTAL $4.00", HtmlBody: "" };
}

beforeEach(() => {
  process.env.POSTMARK_WEBHOOK_USERNAME = "webhook-user";
  process.env.POSTMARK_WEBHOOK_PASSWORD = "webhook-password";
});

afterEach(() => {
  delete process.env.POSTMARK_WEBHOOK_USERNAME;
  delete process.env.POSTMARK_WEBHOOK_PASSWORD;
});

describe("POST /api/webhooks/email/postmark", () => {
  it("returns 403 for missing or wrong Basic credentials", async () => {
    expect((await POST(request(payload("x")))).status).toBe(403);
    expect((await POST(request(payload("x"), auth("wrong:value")))).status).toBe(403);
  });

  it("creates one receipt and safely acknowledges a retry", async () => {
    const user = await registerTestUser();
    const mailboxToken = randomUUID();
    await prisma.inboundEmailAddress.create({ data: { userId: user.userId, mailboxToken } });
    const body = payload(mailboxToken);
    expect((await POST(request(body, auth()))).status).toBe(201);
    const retry = await POST(request(body, auth()));
    expect(retry.status).toBe(200);
    expect(await retry.json()).toEqual({ status: "duplicate" });
  });

  it("does not disclose unknown mailbox existence and rejects malformed input", async () => {
    const unknown = await POST(request(payload("unknown"), auth()));
    expect(unknown.status).toBe(200);
    expect(await unknown.json()).toEqual({ status: "ignored" });
    expect((await POST(request("not-json", auth()))).status).toBe(400);
    expect((await POST(request({ MessageID: "" }, auth()))).status).toBe(400);
  });
});
