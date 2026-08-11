import { randomBytes } from "node:crypto";
import { Client as MinioClient } from "minio";

// Session 4 (RECEIPTLESS_STATE.md): replaces Phase 0's inline data:image/*
// URL storage with real object storage. Works against local MinIO
// (docker-compose.yml) today and a real S3/R2 bucket later purely via env
// vars — that's the point of using an S3-compatible client (`minio`, which
// speaks the S3 API against any S3-compatible endpoint, not just MinIO
// itself) rather than a MinIO-only SDK.
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // matches Phase 0's imageUrlSchema cap

export type ImageContentType = "image/jpeg" | "image/png" | "image/webp";

const EXTENSION_BY_CONTENT_TYPE: Record<ImageContentType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/**
 * Identifies an image's real format from its own bytes (magic-byte
 * signatures), never trusting a client-supplied filename or Content-Type
 * header — both are attacker-controlled input. Returns null for anything
 * that isn't one of the three formats receiptless accepts.
 */
export function sniffImageContentType(bytes: Buffer): ImageContentType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return "image/png";
  }
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
    bytes.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

/**
 * `ownerId` must always come from the authenticated session server-side,
 * never from client-supplied input — that's what stops any caller from
 * choosing (or guessing into) another user's object namespace. The random
 * component is generated server-side too, so a key is never derived from
 * anything an attacker could predict or enumerate.
 */
export function receiptImageKey(ownerId: string, contentType: ImageContentType): string {
  const random = randomBytes(24).toString("base64url");
  return `receipts/${ownerId}/${random}.${EXTENSION_BY_CONTENT_TYPE[contentType]}`;
}

export interface ObjectStorage {
  put(key: string, bytes: Buffer, contentType: string): Promise<void>;
  getSignedUrl(key: string): Promise<string>;
  delete(key: string): Promise<void>;
}

const BUCKET = process.env.S3_BUCKET ?? "receiptless-dev";
const SIGNED_URL_TTL_SECONDS = 5 * 60;

let client: MinioClient | undefined;
function getClient(): MinioClient {
  if (!client) {
    const endpoint = new URL(process.env.S3_ENDPOINT ?? "http://localhost:9000");
    client = new MinioClient({
      endPoint: endpoint.hostname,
      port: endpoint.port ? Number(endpoint.port) : undefined,
      useSSL: endpoint.protocol === "https:",
      region: process.env.S3_REGION ?? "us-east-1",
      accessKey: process.env.S3_ACCESS_KEY_ID ?? "receiptless",
      secretKey: process.env.S3_SECRET_ACCESS_KEY ?? "receiptless-dev-secret",
    });
  }
  return client;
}

let bucketEnsured = false;
async function ensureBucket(): Promise<void> {
  if (bucketEnsured) return;
  const s3 = getClient();
  // Local/dev convenience only (MinIO starts with no buckets). A real S3/R2
  // bucket in production is Omar's own to create and hand credentials for
  // (RECEIPTLESS_STATE.md's Session 4 scope) — this just means local dev
  // and CI never need a manual `mc mb` step. `bucketExists` already no-ops
  // correctly against a bucket that was created out-of-band, so this is
  // safe to run against a real provisioned bucket too.
  const exists = await s3.bucketExists(BUCKET).catch(() => false);
  if (!exists) {
    await s3.makeBucket(BUCKET, process.env.S3_REGION ?? "us-east-1");
  }
  bucketEnsured = true;
}

export const s3Storage: ObjectStorage = {
  async put(key, bytes, contentType) {
    await ensureBucket();
    await getClient().putObject(BUCKET, key, bytes, bytes.length, { "Content-Type": contentType });
  },
  async getSignedUrl(key) {
    // Short-lived — the bucket itself is never public, so a fetched image
    // URL is only ever valid for a few minutes, not a permanent link
    // anyone who captures it could reuse indefinitely.
    return getClient().presignedGetObject(BUCKET, key, SIGNED_URL_TTL_SECONDS);
  },
  async delete(key) {
    await getClient().removeObject(BUCKET, key);
  },
};

// Test-only injection seam, mirroring IDent's FakeGoogleOAuthClient
// pattern (identity/service.ts): production code always calls
// getObjectStorage() rather than importing s3Storage directly, so tests
// can install an in-memory fake (src/test/fake-object-storage.ts) instead
// of requiring a real MinIO/S3 endpoint in CI.
let currentStorage: ObjectStorage = s3Storage;

export function getObjectStorage(): ObjectStorage {
  return currentStorage;
}

export function setObjectStorage(storage: ObjectStorage): void {
  currentStorage = storage;
}
