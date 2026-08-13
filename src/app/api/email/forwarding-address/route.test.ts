import { NextRequest } from "next/server";
import { afterEach, describe, expect, it } from "vitest";
import { cookieHeader, registerTestUser } from "@/test/auth-helpers";
import { GET } from "./route";

const originalAddress = process.env.POSTMARK_INBOUND_ADDRESS;

function request(token?: string) {
  return new NextRequest("http://localhost/api/email/forwarding-address", {
    headers: cookieHeader(token),
  });
}

afterEach(() => {
  if (originalAddress === undefined) delete process.env.POSTMARK_INBOUND_ADDRESS;
  else process.env.POSTMARK_INBOUND_ADDRESS = originalAddress;
});

describe("GET /api/email/forwarding-address", () => {
  it("rejects an unauthenticated request", async () => {
    process.env.POSTMARK_INBOUND_ADDRESS = "receipts@inbound.postmarkapp.com";
    expect((await GET(request())).status).toBe(401);
  });

  it("returns one stable opaque plus-address per user", async () => {
    process.env.POSTMARK_INBOUND_ADDRESS = "receipts@inbound.postmarkapp.com";
    const alice = await registerTestUser();
    const bob = await registerTestUser();

    const first = await (await GET(request(alice.token))).json();
    const repeated = await (await GET(request(alice.token))).json();
    const other = await (await GET(request(bob.token))).json();

    expect(first.address).toMatch(/^receipts\+[A-Za-z0-9_-]{24}@inbound\.postmarkapp\.com$/);
    expect(repeated.address).toBe(first.address);
    expect(other.address).not.toBe(first.address);
  });

  it("reports unavailable configuration instead of inventing an address", async () => {
    delete process.env.POSTMARK_INBOUND_ADDRESS;
    const user = await registerTestUser();
    const response = await GET(request(user.token));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Inbound email is not configured." });
  });
});
