import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { isDeployedEnvironment } from "./deployment";

/**
 * Session 9: AES-256-GCM for the OAuth token payload stored on
 * EmailConnection.encryptedTokenData.
 *
 * Same shape as IDent's comms/token-encryption.ts (that repo solved this
 * first, in its session 14) — iv + authTag + ciphertext packed into a
 * single opaque base64url column, so token material is never structured
 * plaintext a stray query or log line could expose.
 */
const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12; // GCM's standard nonce size
const AUTH_TAG_BYTES = 16;

/**
 * The local-dev key. It is **committed, therefore public**, and exists only
 * so the connect flow works on a clean checkout without configuration.
 *
 * It must never encrypt a real token. Gmail refresh tokens are long-lived
 * credentials to somebody's whole mailbox; encrypting them under a key
 * anyone can read from this repository is equivalent to storing them in
 * plaintext. `resolveEncryptionKey` therefore refuses to fall back to it in
 * any deployed environment — see the guard below.
 */
const DEV_ONLY_KEY_BASE64 = "Zx1pQ7yv3TgK8sHn2WdRfLmC5bJaVeXu9oPtYiUq0Ec=";

export class InsecureEncryptionKeyError extends Error {
  constructor() {
    super(
      "EMAIL_OAUTH_ENCRYPTION_KEY must be set to a unique 32-byte base64 key in any deployed environment. " +
        "The built-in development key is committed to this repository and must never encrypt real tokens.",
    );
    this.name = "InsecureEncryptionKeyError";
  }
}

/**
 * `?.trim() ||` rather than `??` deliberately: a blank value in a copied
 * .env means "not configured", identical to unset — IDent hit exactly this
 * bug (its API refused to boot on a clean checkout).
 */
export function resolveEncryptionKey(env: NodeJS.ProcessEnv = process.env): Buffer {
  const configured = env.EMAIL_OAUTH_ENCRYPTION_KEY?.trim();

  if (!configured) {
    // Fails closed: a deployment without its own key cannot start the
    // OAuth paths at all, rather than quietly using the public one.
    if (isDeployedEnvironment(env)) throw new InsecureEncryptionKeyError();
    return Buffer.from(DEV_ONLY_KEY_BASE64, "base64");
  }

  const key = Buffer.from(configured, "base64");
  if (key.length !== 32) {
    throw new Error("EMAIL_OAUTH_ENCRYPTION_KEY must decode to exactly 32 bytes (AES-256).");
  }
  // Setting the public dev key explicitly is the same hazard as omitting it.
  if (isDeployedEnvironment(env) && key.equals(Buffer.from(DEV_ONLY_KEY_BASE64, "base64"))) {
    throw new InsecureEncryptionKeyError();
  }
  return key;
}

/**
 * Resolved lazily rather than at module load: an import-time throw would
 * take down every route in the app, including the /api/health endpoint
 * that is supposed to *report* the misconfiguration.
 */
let cachedKey: Buffer | null = null;
function encryptionKey(): Buffer {
  cachedKey ??= resolveEncryptionKey();
  return cachedKey;
}

export class TokenDecryptionError extends Error {
  constructor() {
    super("Could not decrypt the stored OAuth token payload.");
    this.name = "TokenDecryptionError";
  }
}

export function encryptTokens(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64url");
}

/**
 * GCM's auth tag means a tampered or truncated blob fails here rather than
 * silently decrypting to garbage that later code would treat as a token.
 */
export function decryptTokens(packed: string): string {
  const buf = Buffer.from(packed, "base64url");
  if (buf.length < IV_BYTES + AUTH_TAG_BYTES) throw new TokenDecryptionError();
  try {
    const decipher = createDecipheriv(ALGORITHM, encryptionKey(), buf.subarray(0, IV_BYTES));
    decipher.setAuthTag(buf.subarray(IV_BYTES, IV_BYTES + AUTH_TAG_BYTES));
    return Buffer.concat([decipher.update(buf.subarray(IV_BYTES + AUTH_TAG_BYTES)), decipher.final()]).toString("utf8");
  } catch {
    throw new TokenDecryptionError();
  }
}

export type StoredTokens = {
  accessToken: string;
  refreshToken: string;
  /** Epoch millis. */
  expiresAt: number;
};

export function packTokens(tokens: StoredTokens): string {
  return encryptTokens(JSON.stringify(tokens));
}

export function unpackTokens(packed: string): StoredTokens {
  const parsed = JSON.parse(decryptTokens(packed)) as Partial<StoredTokens>;
  if (
    typeof parsed.accessToken !== "string" ||
    typeof parsed.refreshToken !== "string" ||
    typeof parsed.expiresAt !== "number"
  ) {
    throw new TokenDecryptionError();
  }
  return { accessToken: parsed.accessToken, refreshToken: parsed.refreshToken, expiresAt: parsed.expiresAt };
}
