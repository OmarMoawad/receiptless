import { describe, expect, it } from "vitest";
import { decryptTokens, encryptTokens, packTokens, TokenDecryptionError, unpackTokens } from "./oauth-token-crypto";

const tokens = { accessToken: "at", refreshToken: "rt", expiresAt: 1_800_000_000_000 };

describe("oauth token encryption", () => {
  it("round-trips a token payload", () => {
    expect(unpackTokens(packTokens(tokens))).toEqual(tokens);
  });

  it("produces different ciphertext each time for the same input", () => {
    // A fresh random IV per encryption — identical blobs would leak that
    // two connections hold the same token.
    expect(encryptTokens("same")).not.toBe(encryptTokens("same"));
  });

  it("never leaves the token readable in the stored blob", () => {
    // Distinctive values, long enough that a chance base64 collision isn't
    // what makes this pass — a two-character token would appear by luck.
    const packed = packTokens({
      accessToken: "ya29-DISTINCTIVE-ACCESS-VALUE",
      refreshToken: "1ff-DISTINCTIVE-REFRESH-VALUE",
      expiresAt: 1_800_000_000_000,
    });
    expect(packed).not.toContain("DISTINCTIVE");
    expect(packed).not.toContain("accessToken");
  });

  it("rejects a tampered blob rather than returning garbage", () => {
    const packed = encryptTokens("secret");
    const tampered = `${packed.slice(0, -4)}AAAA`;
    expect(() => decryptTokens(tampered)).toThrow(TokenDecryptionError);
  });

  it("rejects a truncated blob", () => {
    expect(() => decryptTokens("aaaa")).toThrow(TokenDecryptionError);
  });

  it("rejects a decryptable payload that is not a token shape", () => {
    expect(() => unpackTokens(encryptTokens(JSON.stringify({ accessToken: "only" })))).toThrow(TokenDecryptionError);
  });
});
