import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { cookieHeader, registerTestUser } from "@/test/auth-helpers";
import { GET, POST } from "./route";
import { POST as POST_LOCATION } from "./[accountId]/locations/route";
import { POST as POST_MEMBER } from "./[accountId]/members/route";

function req(body: unknown, token?: string): NextRequest {
  return new NextRequest("http://localhost/api/merchant/accounts", {
    method: "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { "content-type": "application/json", ...cookieHeader(token) },
  });
}

function uniqueName(): string {
  return `Route Shop ${randomUUID().slice(0, 8)}`;
}

describe("POST /api/merchant/accounts", () => {
  it("requires a session", async () => {
    const res = await POST(req({ name: uniqueName() }));
    expect(res.status).toBe(401);
  });

  it("creates an account for the signed-in user and returns OWNER", async () => {
    const owner = await registerTestUser();
    const res = await POST(req({ name: uniqueName(), website: "https://pilot.example" }, owner.token));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.role).toBe("OWNER");
  });

  it("rejects an invalid body with 400", async () => {
    const owner = await registerTestUser();
    const res = await POST(req({ name: "" }, owner.token));
    expect(res.status).toBe(400);
  });

  it("returns 409 when the merchant name is already taken", async () => {
    const owner = await registerTestUser();
    const name = uniqueName();
    await prisma.merchant.create({ data: { name } });
    const res = await POST(req({ name }, owner.token));
    expect(res.status).toBe(409);
  });

  it("lists only the caller's own accounts", async () => {
    const owner = await registerTestUser();
    const other = await registerTestUser();
    await POST(req({ name: uniqueName() }, owner.token));

    const mine = await GET(
      new NextRequest("http://localhost/api/merchant/accounts", { headers: cookieHeader(owner.token) }),
    );
    const theirs = await GET(
      new NextRequest("http://localhost/api/merchant/accounts", { headers: cookieHeader(other.token) }),
    );
    expect((await mine.json()).accounts.length).toBeGreaterThan(0);
    expect((await theirs.json()).accounts).toEqual([]);
  });
});

describe("member/location route authorization", () => {
  async function makeAccount() {
    const owner = await registerTestUser();
    const res = await POST(req({ name: uniqueName() }, owner.token));
    const account = await res.json();
    return { owner, accountId: account.id as string };
  }

  function locationReq(accountId: string, body: unknown, token?: string): NextRequest {
    return new NextRequest(`http://localhost/api/merchant/accounts/${accountId}/locations`, {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json", ...cookieHeader(token) },
    });
  }

  it("returns 401 when creating a location without a session", async () => {
    const { accountId } = await makeAccount();
    const res = await POST_LOCATION(locationReq(accountId, { externalId: "L1", displayName: "Main" }), {
      params: Promise.resolve({ accountId }),
    });
    expect(res.status).toBe(401);
  });

  it("returns 404 to a non-member (an account they cannot see)", async () => {
    const { accountId } = await makeAccount();
    const outsider = await registerTestUser();
    const res = await POST_LOCATION(
      locationReq(accountId, { externalId: "L1", displayName: "Main" }, outsider.token),
      { params: Promise.resolve({ accountId }) },
    );
    expect(res.status).toBe(404);
  });

  it("returns 403 to a VIEWER trying to create a location", async () => {
    const { owner, accountId } = await makeAccount();
    const viewer = await registerTestUser();
    const added = await POST_MEMBER(
      new NextRequest(`http://localhost/api/merchant/accounts/${accountId}/members`, {
        method: "POST",
        body: JSON.stringify({ userId: viewer.userId, role: "VIEWER" }),
        headers: { "content-type": "application/json", ...cookieHeader(owner.token) },
      }),
      { params: Promise.resolve({ accountId }) },
    );
    expect(added.status).toBe(201);

    const res = await POST_LOCATION(
      locationReq(accountId, { externalId: "L1", displayName: "Main" }, viewer.token),
      { params: Promise.resolve({ accountId }) },
    );
    expect(res.status).toBe(403);
  });
});
