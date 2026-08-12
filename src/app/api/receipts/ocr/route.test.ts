import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getOcrClient, suryaOcrClient, setOcrClient } from "@/lib/ocr-client";
import { FakeOcrClient } from "@/test/fake-ocr-client";
import { cookieHeader, registerTestUser } from "@/test/auth-helpers";
import { POST } from "./route";

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0]);

let fakeOcr: FakeOcrClient;

beforeEach(() => {
  fakeOcr = new FakeOcrClient();
  setOcrClient(fakeOcr);
});

afterEach(() => {
  setOcrClient(suryaOcrClient);
});

function ocrRequest(sessionToken: string | undefined, bytes: Buffer, filename = "receipt.png") {
  const formData = new FormData();
  formData.set("file", new Blob([Uint8Array.from(bytes)]), filename);
  return new NextRequest("http://localhost/api/receipts/ocr", {
    method: "POST",
    body: formData,
    headers: cookieHeader(sessionToken),
  });
}

describe("POST /api/receipts/ocr", () => {
  it("rejects an unauthenticated request with 401, without ever calling the OCR client", async () => {
    const response = await POST(ocrRequest(undefined, PNG_BYTES));
    expect(response.status).toBe(401);
    expect(fakeOcr.recognizeTextCalls).toHaveLength(0);
  });

  it("rejects a non-image payload with 400 and never calls the OCR client", async () => {
    const alice = await registerTestUser();
    const response = await POST(ocrRequest(alice.token, Buffer.from("not an image", "ascii")));
    expect(response.status).toBe(400);
    expect(fakeOcr.recognizeTextCalls).toHaveLength(0);
  });

  it("rejects a payload over the size limit with 400", async () => {
    const alice = await registerTestUser();
    const oversized = Buffer.concat([PNG_BYTES, Buffer.alloc(9 * 1024 * 1024)]);
    const response = await POST(ocrRequest(alice.token, oversized));
    expect(response.status).toBe(400);
    expect(fakeOcr.recognizeTextCalls).toHaveLength(0);
  });

  it("returns the OCR client's recognized text for a valid image", async () => {
    const alice = await registerTestUser();
    fakeOcr.nextText = "Merchant Name\nWidget    9.99\nTotal     9.99";

    const response = await POST(ocrRequest(alice.token, PNG_BYTES));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.text).toBe("Merchant Name\nWidget    9.99\nTotal     9.99");
    expect(fakeOcr.recognizeTextCalls).toHaveLength(1);
    expect(fakeOcr.recognizeTextCalls[0].contentType).toBe("image/png");
  });

  it("returns 502 (not 500) when the OCR service is unreachable/errors", async () => {
    const alice = await registerTestUser();
    fakeOcr.nextText = new Error("service down");

    const response = await POST(ocrRequest(alice.token, PNG_BYTES));
    expect(response.status).toBe(502);
  });
});

// Sanity check on the fake itself, same convention as the photo route's
// own test file: getOcrClient() must actually return what setOcrClient()
// installed, or every test above would silently exercise the wrong double.
describe("OCR client test seam", () => {
  it("getOcrClient returns the installed fake", () => {
    expect(getOcrClient()).toBe(fakeOcr);
  });
});
