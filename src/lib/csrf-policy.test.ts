import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { middleware } from "@/middleware";

function request(method: string, url: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(url, { method, headers });
}

/**
 * External review finding #5 asked for a *consistent* trusted-origin
 * policy. These assert the policy, not one route's version of it.
 */
describe("trusted-origin middleware", () => {
  it("rejects a cross-origin POST", () => {
    const response = middleware(
      request("POST", "http://localhost/api/auth/login", { origin: "https://evil.example" }),
    );
    expect(response.status).toBe(403);
  });

  it("rejects a cross-origin POST that only carries a Referer", () => {
    const response = middleware(
      request("POST", "http://localhost/api/receipts", { referer: "https://evil.example/attack" }),
    );
    expect(response.status).toBe(403);
  });

  it("allows a same-origin POST", () => {
    const response = middleware(request("POST", "http://localhost/api/receipts", { origin: "http://localhost" }));
    expect(response.status).toBe(200);
  });

  it("allows a server-to-server POST with neither header — Postmark, a POS terminal", () => {
    // Their control is their own credential (Basic auth, an env gate); an
    // origin check is only ever meaningful against a browser.
    expect(middleware(request("POST", "http://localhost/api/webhooks/email/postmark")).status).toBe(200);
    expect(middleware(request("POST", "http://localhost/api/merchant/receipts")).status).toBe(200);
  });

  it("leaves GET alone, so the Gmail OAuth callback still works", () => {
    // A top-level redirect back from Google legitimately carries a
    // cross-site Referer. Checking GET here would break connecting an
    // account every single time.
    const response = middleware(
      request("GET", "http://localhost/api/email/connections/gmail/callback?code=x", {
        referer: "https://accounts.google.com/",
      }),
    );
    expect(response.status).toBe(200);
  });

  it("covers every mutating method, not just POST", () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const response = middleware(request(method, "http://localhost/api/receipts", { origin: "https://evil.example" }));
      expect(response.status, `${method} should be rejected cross-origin`).toBe(403);
    }
  });
});

/**
 * The structural guard. IDent applies its limits in one Fastify hook, so
 * a route cannot be added without one; Next.js middleware runs on the
 * edge runtime where Prisma cannot follow, so the same trick is not
 * available here and every mutating handler calls `enforceRateLimit`
 * itself. This test is what stops that drifting — it fails when a new
 * mutating route lands without a limit, which is precisely how the
 * reviewed state came about.
 */
function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return routeFiles(full);
    return entry === "route.ts" ? [full] : [];
  });
}

describe("rate limit coverage", () => {
  it("every mutating API route calls enforceRateLimit", () => {
    const apiDir = path.join(process.cwd(), "src/app/api");
    const unprotected = routeFiles(apiDir).filter((file) => {
      const source = readFileSync(file, "utf8");
      const mutates = /export async function (POST|PUT|PATCH|DELETE)\b/.test(source);
      return mutates && !source.includes("enforceRateLimit");
    });

    expect(unprotected.map((f) => path.relative(process.cwd(), f))).toEqual([]);
  });
});
