import { NextRequest } from "next/server";
import { beforeAll, describe, expect, it } from "vitest";
import { POST as createReceipt } from "@/app/api/receipts/route";
import { PATCH as patchCoverage } from "@/app/api/receipts/[id]/items/[itemId]/route";
import { POST as addItem } from "@/app/api/receipts/[id]/items/route";
import { cookieHeader, registerTestUser } from "@/test/auth-helpers";

function jsonRequest(url: string, body: unknown, token?: string): NextRequest {
  return new NextRequest(url, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", ...cookieHeader(token) },
  });
}

async function newReceipt(token: string): Promise<string> {
  const response = await createReceipt(
    jsonRequest(
      "http://localhost/api/receipts",
      {
        merchant: `Coverage Route Co ${Math.random().toString(36).slice(2, 8)}`,
        totalMinor: 4999,
        currency: "GBP",
        purchasedAt: "2026-08-15",
      },
      token,
    ),
  );
  expect(response.status).toBe(201);
  return (await response.json()).id;
}

describe("adding an item to an existing receipt", () => {
  let alice: Awaited<ReturnType<typeof registerTestUser>>;
  let bob: Awaited<ReturnType<typeof registerTestUser>>;

  beforeAll(async () => {
    alice = await registerTestUser();
    bob = await registerTestUser();
  });

  it("creates one with coverage and no price stated", async () => {
    const receiptId = await newReceipt(alice.token);
    const response = await addItem(
      jsonRequest(
        `http://localhost/api/receipts/${receiptId}/items`,
        { name: "Kettle", warrantyMonths: 24, returnWindowDays: 30 },
        alice.token,
      ),
      { params: Promise.resolve({ id: receiptId }) },
    );
    expect(response.status).toBe(201);
    const item = await response.json();
    expect(item.warrantyMonths).toBe(24);
    // Defaulted, because the point of this route is tracking the warranty
    // on a receipt whose line items were never captured.
    expect(item.totalPriceMinor).toBe(0);
  });

  it("refuses without a session", async () => {
    const receiptId = await newReceipt(alice.token);
    const response = await addItem(
      jsonRequest(`http://localhost/api/receipts/${receiptId}/items`, { name: "Kettle" }),
      { params: Promise.resolve({ id: receiptId }) },
    );
    expect(response.status).toBe(401);
  });

  it("will not add an item to someone else's receipt", async () => {
    const receiptId = await newReceipt(alice.token);
    const response = await addItem(
      jsonRequest(`http://localhost/api/receipts/${receiptId}/items`, { name: "Intruder" }, bob.token),
      { params: Promise.resolve({ id: receiptId }) },
    );
    // 404 rather than 403: Bob learns nothing about whether that id exists.
    expect(response.status).toBe(404);
  });

  it.each([
    [{ name: "Kettle", warrantyMonths: 601 }, "warranty"],
    [{ name: "Kettle", returnWindowDays: 3651 }, "return window"],
    [{ name: "Kettle", unitPriceMinor: -1 }, "negative price"],
    [{ name: "Kettle", totalPriceMinor: 2_147_483_648 }, "out-of-range price"],
  ])("rejects an invalid item payload: %s", async (payload, _label) => {
    const receiptId = await newReceipt(alice.token);
    const response = await addItem(
      jsonRequest(`http://localhost/api/receipts/${receiptId}/items`, payload, alice.token),
      { params: Promise.resolve({ id: receiptId }) },
    );
    expect(response.status).toBe(400);
  });
});

describe("editing an item's coverage", () => {
  let alice: Awaited<ReturnType<typeof registerTestUser>>;
  let bob: Awaited<ReturnType<typeof registerTestUser>>;
  let receiptId: string;
  let itemId: string;

  beforeAll(async () => {
    alice = await registerTestUser();
    bob = await registerTestUser();
    receiptId = await newReceipt(alice.token);
    const created = await addItem(
      jsonRequest(
        `http://localhost/api/receipts/${receiptId}/items`,
        { name: "Headphones", warrantyMonths: 12, returnWindowDays: 14 },
        alice.token,
      ),
      { params: Promise.resolve({ id: receiptId }) },
    );
    itemId = (await created.json()).id;
  });

  function patch(body: unknown, token?: string, item = itemId) {
    const request = new NextRequest(
      `http://localhost/api/receipts/${receiptId}/items/${item}`,
      {
        method: "PATCH",
        body: JSON.stringify(body),
        headers: { "content-type": "application/json", ...cookieHeader(token) },
      },
    );
    return patchCoverage(request, { params: Promise.resolve({ id: receiptId, itemId: item }) });
  }

  it("leaves an omitted field alone and clears an explicit null", async () => {
    // The distinction the whole schema turns on: absent means "unchanged",
    // null means "remove it".
    const response = await patch({ returnWindowDays: null }, alice.token);
    expect(response.status).toBe(200);
    const item = await response.json();
    expect(item.returnWindowDays).toBeNull();
    expect(item.warrantyMonths).toBe(12);
  });

  it("rejects a nonsense window rather than storing it", async () => {
    const response = await patch({ warrantyMonths: 0 }, alice.token);
    expect(response.status).toBe(400);
  });

  it("rejects a warranty longer than any real one", async () => {
    const response = await patch({ warrantyMonths: 24_000 }, alice.token);
    expect(response.status).toBe(400);
  });

  it.each([
    [{}, "an empty body"],
    [{ merchantName: "Not a coverage field" }, "an unknown-only body"],
    [{ warrantyMonth: 12 }, "a misspelled coverage field"],
  ])("rejects %s rather than reporting a successful no-op", async (body, _label) => {
    const response = await patch(body, alice.token);
    expect(response.status).toBe(400);
  });

  it("will not edit another user's item", async () => {
    const response = await patch({ warrantyMonths: 99 }, bob.token);
    expect(response.status).toBe(404);
  });

  it("will not edit an item that belongs to a different receipt", async () => {
    // The URL nesting is not what enforces this — the query is. An item id
    // that exists but hangs off another receipt must not be editable
    // through this receipt's path.
    const otherReceipt = await newReceipt(alice.token);
    const created = await addItem(
      jsonRequest(`http://localhost/api/receipts/${otherReceipt}/items`, { name: "Elsewhere" }, alice.token),
      { params: Promise.resolve({ id: otherReceipt }) },
    );
    const foreignItemId = (await created.json()).id;
    const response = await patch({ warrantyMonths: 12 }, alice.token, foreignItemId);
    expect(response.status).toBe(404);
  });
});
