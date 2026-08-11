import { describe, expect, it } from "vitest";
import { receiptImageKey, sniffImageContentType } from "./storage";

const JPEG_HEADER = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const WEBP_HEADER = Buffer.concat([
  Buffer.from("RIFF", "ascii"),
  Buffer.from([0, 0, 0, 0]),
  Buffer.from("WEBP", "ascii"),
]);

describe("sniffImageContentType", () => {
  it("identifies a JPEG from its magic bytes", () => {
    expect(sniffImageContentType(JPEG_HEADER)).toBe("image/jpeg");
  });

  it("identifies a PNG from its magic bytes", () => {
    expect(sniffImageContentType(PNG_HEADER)).toBe("image/png");
  });

  it("identifies a WEBP from its magic bytes", () => {
    expect(sniffImageContentType(WEBP_HEADER)).toBe("image/webp");
  });

  it("rejects a mislabeled non-image file (e.g. a script with a fake extension)", () => {
    expect(sniffImageContentType(Buffer.from("#!/bin/sh\necho hi\n", "ascii"))).toBeNull();
  });

  it("rejects a truncated/empty buffer instead of throwing", () => {
    expect(sniffImageContentType(Buffer.alloc(0))).toBeNull();
    expect(sniffImageContentType(Buffer.from([0xff]))).toBeNull();
  });

  it("does not confuse a PNG-like prefix with an actual PNG", () => {
    const almostPng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00, 0x00, 0x00]);
    expect(sniffImageContentType(almostPng)).toBeNull();
  });
});

describe("receiptImageKey", () => {
  it("is namespaced under the given owner and uses the right extension", () => {
    const key = receiptImageKey("user_abc", "image/png");
    expect(key).toMatch(/^receipts\/user_abc\/[A-Za-z0-9_-]+\.png$/);
  });

  it("maps each content type to its own extension", () => {
    expect(receiptImageKey("u", "image/jpeg")).toMatch(/\.jpg$/);
    expect(receiptImageKey("u", "image/webp")).toMatch(/\.webp$/);
  });

  it("generates unique, unpredictable keys across calls for the same owner", () => {
    const keys = new Set(Array.from({ length: 20 }, () => receiptImageKey("same_owner", "image/png")));
    expect(keys.size).toBe(20);
  });

  it("never lets one owner's key collide into another owner's namespace", () => {
    const a = receiptImageKey("alice", "image/png");
    const b = receiptImageKey("bob", "image/png");
    expect(a.startsWith("receipts/alice/")).toBe(true);
    expect(b.startsWith("receipts/bob/")).toBe(true);
  });
});
