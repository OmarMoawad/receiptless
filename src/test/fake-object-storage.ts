import type { ObjectStorage } from "@/lib/storage";

/**
 * In-memory ObjectStorage double for tests — mirrors IDent's
 * FakeGoogleOAuthClient pattern (identity/test-support): route/handler
 * tests exercise real request/response and real Postgres, but swap the
 * one genuinely external dependency (an S3-compatible endpoint) for a
 * fake, so CI doesn't need a MinIO service container. Real MinIO is still
 * exercised manually (RECEIPTLESS_STATE.md's "Completed components" for
 * this session) — this fake only stands in for automated tests.
 */
export class FakeObjectStorage implements ObjectStorage {
  readonly objects = new Map<string, { bytes: Buffer; contentType: string }>();

  async put(key: string, bytes: Buffer, contentType: string): Promise<void> {
    this.objects.set(key, { bytes, contentType });
  }

  async getSignedUrl(key: string): Promise<string> {
    return `https://fake-storage.test/${key}?signed=1`;
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }
}
