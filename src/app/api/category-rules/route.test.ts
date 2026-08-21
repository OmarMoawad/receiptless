import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { cookieHeader, registerTestUser } from "@/test/auth-helpers";
import { POST as createReceipt } from "@/app/api/receipts/route";
import { GET, POST } from "./route";
import { DELETE } from "./[id]/route";

function jsonRequest(url: string, body: unknown, token?: string, method = "POST"): NextRequest {
  return new NextRequest(url, {
    method,
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", ...cookieHeader(token) },
  });
}

const RULES_URL = "http://localhost/api/category-rules";

describe("category rules", () => {
  it("rejects an unauthenticated caller", async () => {
    expect((await GET(new NextRequest(RULES_URL))).status).toBe(401);
    expect((await POST(jsonRequest(RULES_URL, { pattern: "x", category: "DINING", target: "MERCHANT" }))).status).toBe(401);
  });

  it("refuses a pattern too short to be a rule", async () => {
    const owner = await registerTestUser();
    // A one-character substring matches nearly every merchant name, and
    // the damage is silent: a whole vault quietly recategorised.
    const response = await POST(
      jsonRequest(RULES_URL, { pattern: "a", category: "DINING", target: "MERCHANT" }, owner.token),
    );
    expect(response.status).toBe(400);
  });

  it("edits the existing rule when the same pattern is added twice", async () => {
    const owner = await registerTestUser();
    const pattern = `shop-${randomUUID().slice(0, 8)}`;

    await POST(jsonRequest(RULES_URL, { pattern, category: "DINING", target: "MERCHANT" }, owner.token));
    await POST(jsonRequest(RULES_URL, { pattern, category: "HEALTH", target: "MERCHANT" }, owner.token));

    const listed = await (await GET(new NextRequest(RULES_URL, { headers: cookieHeader(owner.token) }))).json();
    const matching = listed.rules.filter((rule: { pattern: string }) => rule.pattern === pattern);

    // Two rules on one pattern means the second can never fire.
    expect(matching).toHaveLength(1);
    expect(matching[0].category).toBe("HEALTH");
  });

  it("never lists or deletes another owner's rule", async () => {
    const owner = await registerTestUser();
    const stranger = await registerTestUser();
    const pattern = `private-${randomUUID().slice(0, 8)}`;

    const created = await (
      await POST(jsonRequest(RULES_URL, { pattern, category: "DINING", target: "MERCHANT" }, owner.token))
    ).json();

    const strangerList = await (
      await GET(new NextRequest(RULES_URL, { headers: cookieHeader(stranger.token) }))
    ).json();
    expect(strangerList.rules.map((r: { id: string }) => r.id)).not.toContain(created.id);

    const deleted = await DELETE(
      new NextRequest(`${RULES_URL}/${created.id}`, { method: "DELETE", headers: cookieHeader(stranger.token) }),
      { params: Promise.resolve({ id: created.id }) },
    );
    // 404 rather than 403: declining to confirm the id exists at all.
    expect(deleted.status).toBe(404);
    expect(await prisma.categoryRule.findUnique({ where: { id: created.id } })).not.toBeNull();
  });

  it("changes how a later receipt is filed, end to end", async () => {
    const owner = await registerTestUser();
    const merchant = `Zzyzx Holdings ${randomUUID().slice(0, 8)}`;

    // No default rule has an opinion about this name, so without a rule
    // the receipt stays OTHER.
    const before = await (
      await createReceipt(
        jsonRequest("http://localhost/api/receipts", {
          merchant,
          currency: "USD",
          totalMinor: 500,
          purchasedAt: "2026-03-01T00:00:00.000Z",
        }, owner.token),
      )
    ).json();
    expect(before.category).toBe("OTHER");

    await POST(jsonRequest(RULES_URL, { pattern: "zzyzx", category: "TRAVEL", target: "MERCHANT" }, owner.token));

    const after = await (
      await createReceipt(
        jsonRequest("http://localhost/api/receipts", {
          merchant,
          currency: "USD",
          totalMinor: 500,
          purchasedAt: "2026-03-02T00:00:00.000Z",
        }, owner.token),
      )
    ).json();
    expect(after.category).toBe("TRAVEL");
  });

  it("does not overwrite a category the caller chose", async () => {
    const owner = await registerTestUser();
    const merchant = `Zzyzx Chosen ${randomUUID().slice(0, 8)}`;
    await POST(jsonRequest(RULES_URL, { pattern: "zzyzx chosen", category: "TRAVEL", target: "MERCHANT" }, owner.token));

    const created = await (
      await createReceipt(
        jsonRequest("http://localhost/api/receipts", {
          merchant,
          currency: "USD",
          totalMinor: 500,
          category: "EDUCATION",
          purchasedAt: "2026-03-03T00:00:00.000Z",
        }, owner.token),
      )
    ).json();

    expect(created.category).toBe("EDUCATION");
  });
});
