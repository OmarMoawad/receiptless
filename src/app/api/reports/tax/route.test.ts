import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { cookieHeader, registerTestUser } from "@/test/auth-helpers";
import { GET } from "./route";
import { GET as csvGet } from "@/app/api/export/tax/csv/route";

const request = (query: string, token?: string) =>
  new NextRequest(`http://localhost/api/reports/tax${query}`, { headers: cookieHeader(token) });

describe("GET /api/reports/tax", () => {
  it("rejects an unauthenticated caller", async () => {
    expect((await GET(request(""))).status).toBe(401);
  });

  it("defaults to the current year", async () => {
    const owner = await registerTestUser();
    const body = await (await GET(request("", owner.token))).json();
    expect(body.year).toBe(new Date().getUTCFullYear());
  });

  it("refuses a year that is not a year", async () => {
    const owner = await registerTestUser();
    for (const bad of ["?year=abc", "?year=12", "?year=2026.5", "?year=-2026"]) {
      expect((await GET(request(bad, owner.token))).status).toBe(400);
    }
  });
});

describe("GET /api/export/tax/csv", () => {
  it("rejects an unauthenticated caller", async () => {
    const response = await csvGet(
      new NextRequest("http://localhost/api/export/tax/csv"),
    );
    expect(response.status).toBe(401);
  });

  it("returns a downloadable CSV named for the year", async () => {
    const owner = await registerTestUser();
    const response = await csvGet(
      new NextRequest("http://localhost/api/export/tax/csv?year=2026", {
        headers: cookieHeader(owner.token),
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/csv");
    expect(response.headers.get("content-disposition")).toContain("receiptless-tax-summary-2026.csv");
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
});
