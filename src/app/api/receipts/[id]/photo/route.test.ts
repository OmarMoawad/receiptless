import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { getObjectStorage, s3Storage, setObjectStorage } from "@/lib/storage";
import { FakeObjectStorage } from "@/test/fake-object-storage";
import { cookieHeader, registerTestUser } from "@/test/auth-helpers";
import { POST as receiptsPost } from "@/app/api/receipts/route";
import { GET, POST } from "./route";

const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0,
]);

let fakeStorage: FakeObjectStorage;

beforeEach(() => {
  fakeStorage = new FakeObjectStorage();
  setObjectStorage(fakeStorage);
});

afterEach(() => {
  setObjectStorage(s3Storage);
});

async function createReceiptFor(sessionToken: string): Promise<string> {
  const response = await receiptsPost(
    new NextRequest("http://localhost/api/receipts", {
      method: "POST",
      body: JSON.stringify({
        merchant: `Photo Test Merchant ${randomUUID().slice(0, 8)}`,
        currency: "USD",
        totalMinor: 500,
        purchasedAt: "2026-08-11T10:00:00Z",
      }),
      headers: { "content-type": "application/json", ...cookieHeader(sessionToken) },
    }),
  );
  const body = await response.json();
  return body.id;
}

function uploadRequest(receiptId: string, sessionToken: string | undefined, bytes: Buffer, filename = "receipt.png") {
  const formData = new FormData();
  formData.set("file", new Blob([Uint8Array.from(bytes)]), filename);
  return new NextRequest(`http://localhost/api/receipts/${receiptId}/photo`, {
    method: "POST",
    body: formData,
    headers: cookieHeader(sessionToken),
  });
}

function callPost(receiptId: string, sessionToken: string | undefined, bytes: Buffer) {
  return POST(uploadRequest(receiptId, sessionToken, bytes), { params: Promise.resolve({ id: receiptId }) });
}

function callGet(receiptId: string, sessionToken?: string) {
  const request = new NextRequest(`http://localhost/api/receipts/${receiptId}/photo`, {
    headers: cookieHeader(sessionToken),
  });
  return GET(request, { params: Promise.resolve({ id: receiptId }) });
}

describe("POST /api/receipts/[id]/photo", () => {
  it("rejects an unauthenticated request with 401", async () => {
    const alice = await registerTestUser();
    const receiptId = await createReceiptFor(alice.token);

    const response = await callPost(receiptId, undefined, PNG_BYTES);
    expect(response.status).toBe(401);
  });

  it("rejects uploading onto another user's receipt with 404 (tenant isolation)", async () => {
    const alice = await registerTestUser();
    const bob = await registerTestUser();
    const bobReceiptId = await createReceiptFor(bob.token);

    const response = await callPost(bobReceiptId, alice.token, PNG_BYTES);
    expect(response.status).toBe(404);
    expect(fakeStorage.objects.size).toBe(0);
  });

  it("rejects an unknown receipt id with 404", async () => {
    const alice = await registerTestUser();
    const response = await callPost(randomUUID(), alice.token, PNG_BYTES);
    expect(response.status).toBe(404);
  });

  it("uploads a valid PNG, storing it under the owner's namespace and setting imageKey", async () => {
    const alice = await registerTestUser();
    const receiptId = await createReceiptFor(alice.token);

    const response = await callPost(receiptId, alice.token, PNG_BYTES);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.imageKey).toMatch(new RegExp(`^receipts/${alice.userId}/`));

    const stored = await prisma.receipt.findUnique({ where: { id: receiptId } });
    expect(stored?.imageKey).toBe(body.imageKey);
    expect(fakeStorage.objects.has(body.imageKey)).toBe(true);
    expect(fakeStorage.objects.get(body.imageKey)?.contentType).toBe("image/png");
  });

  it("rejects a non-image payload with 400 and never calls storage", async () => {
    const alice = await registerTestUser();
    const receiptId = await createReceiptFor(alice.token);

    const response = await callPost(receiptId, alice.token, Buffer.from("not an image", "ascii"));
    expect(response.status).toBe(400);
    expect(fakeStorage.objects.size).toBe(0);

    const stored = await prisma.receipt.findUnique({ where: { id: receiptId } });
    expect(stored?.imageKey).toBeNull();
  });

  it("rejects a payload over the size limit with 400", async () => {
    const alice = await registerTestUser();
    const receiptId = await createReceiptFor(alice.token);

    const oversized = Buffer.concat([PNG_BYTES, Buffer.alloc(9 * 1024 * 1024)]);
    const response = await callPost(receiptId, alice.token, oversized);
    expect(response.status).toBe(400);
    expect(fakeStorage.objects.size).toBe(0);
  });

  it("replacing a photo deletes the old object instead of orphaning it", async () => {
    const alice = await registerTestUser();
    const receiptId = await createReceiptFor(alice.token);

    const first = await callPost(receiptId, alice.token, PNG_BYTES);
    const { imageKey: firstKey } = await first.json();
    expect(fakeStorage.objects.has(firstKey)).toBe(true);

    const second = await callPost(receiptId, alice.token, PNG_BYTES);
    const { imageKey: secondKey } = await second.json();

    expect(secondKey).not.toBe(firstKey);
    expect(fakeStorage.objects.has(firstKey)).toBe(false);
    expect(fakeStorage.objects.has(secondKey)).toBe(true);
  });
});

describe("GET /api/receipts/[id]/photo", () => {
  it("rejects an unauthenticated request with 401", async () => {
    const alice = await registerTestUser();
    const receiptId = await createReceiptFor(alice.token);
    const response = await callGet(receiptId);
    expect(response.status).toBe(401);
  });

  it("returns 404 when the receipt has no photo yet", async () => {
    const alice = await registerTestUser();
    const receiptId = await createReceiptFor(alice.token);
    const response = await callGet(receiptId, alice.token);
    expect(response.status).toBe(404);
  });

  it("redirects to a signed URL scoped to the receipt's own image key", async () => {
    const alice = await registerTestUser();
    const receiptId = await createReceiptFor(alice.token);
    await callPost(receiptId, alice.token, PNG_BYTES);

    const response = await callGet(receiptId, alice.token);
    expect(response.status).toBe(307);
    const location = response.headers.get("location");
    expect(location).toContain(`receipts/${alice.userId}/`);
  });

  it("cannot fetch another user's receipt photo, even knowing its id (tenant isolation)", async () => {
    const alice = await registerTestUser();
    const bob = await registerTestUser();
    const bobReceiptId = await createReceiptFor(bob.token);
    await callPost(bobReceiptId, bob.token, PNG_BYTES);

    const response = await callGet(bobReceiptId, alice.token);
    expect(response.status).toBe(404);
  });
});

// Sanity check on the fake itself: getObjectStorage() must actually return
// what setObjectStorage() installed, or every test above would be
// exercising the wrong double without failing loudly.
describe("object storage test seam", () => {
  it("getObjectStorage returns the installed fake", () => {
    expect(getObjectStorage()).toBe(fakeStorage);
  });
});
