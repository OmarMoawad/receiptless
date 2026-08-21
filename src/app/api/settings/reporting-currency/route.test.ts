import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { cookieHeader, registerTestUser } from "@/test/auth-helpers";
import { GET, PUT } from "./route";

const URL = "http://localhost/api/settings/reporting-currency";

function putRequest(body: unknown, token?: string): NextRequest {
  return new NextRequest(URL, {
    method: "PUT",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", ...cookieHeader(token) },
  });
}

describe("reporting currency setting", () => {
  it("rejects an unauthenticated caller on both verbs", async () => {
    expect((await GET(new NextRequest(URL))).status).toBe(401);
    expect((await PUT(putRequest({ reportingCurrency: "EGP" }))).status).toBe(401);
  });

  it("defaults a new account to USD", async () => {
    const user = await registerTestUser();
    const response = await GET(new NextRequest(URL, { headers: cookieHeader(user.token) }));
    expect(response.status).toBe(200);
    expect((await response.json()).reportingCurrency).toBe("USD");
  });

  it("changes the currency and persists it", async () => {
    const user = await registerTestUser();
    const response = await PUT(putRequest({ reportingCurrency: "EGP" }, user.token));
    expect(response.status).toBe(200);
    expect((await response.json()).reportingCurrency).toBe("EGP");

    // Persisted, not just echoed.
    const row = await prisma.user.findUniqueOrThrow({
      where: { id: user.userId },
      select: { reportingCurrency: true },
    });
    expect(row.reportingCurrency).toBe("EGP");
  });

  it("upper-cases, so egp and EGP are one thing", async () => {
    const user = await registerTestUser();
    const response = await PUT(putRequest({ reportingCurrency: "egp" }, user.token));
    expect(response.status).toBe(200);
    expect((await response.json()).reportingCurrency).toBe("EGP");
  });

  it("refuses a currency the converter cannot scale, rather than storing it", async () => {
    const user = await registerTestUser();
    // ZZZ has no known minor-unit scale; accepting it would let a receipt
    // be converted into a currency the system cannot then sum correctly.
    const response = await PUT(putRequest({ reportingCurrency: "ZZZ" }, user.token));
    expect(response.status).toBe(400);

    const row = await prisma.user.findUniqueOrThrow({
      where: { id: user.userId },
      select: { reportingCurrency: true },
    });
    expect(row.reportingCurrency).toBe("USD"); // unchanged
  });

  it("refuses a malformed code", async () => {
    const user = await registerTestUser();
    for (const bad of ["", "US", "DOLLAR", 42, null]) {
      expect((await PUT(putRequest({ reportingCurrency: bad }, user.token))).status).toBe(400);
    }
  });
});
