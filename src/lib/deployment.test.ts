import { describe, expect, it } from "vitest";
import { isDeployedEnvironment, isMerchantApiEnabled, missingProductionConfig } from "./deployment";

const local = { NODE_ENV: "development" } as unknown as NodeJS.ProcessEnv;
const deployed = { NODE_ENV: "production" } as unknown as NodeJS.ProcessEnv;
const preview = { NODE_ENV: "production", VERCEL_ENV: "preview" } as unknown as NodeJS.ProcessEnv;

const fullConfig = {
  DATABASE_URL: "postgresql://x",
  S3_ENDPOINT: "https://x",
  S3_BUCKET: "b",
  S3_ACCESS_KEY_ID: "k",
  S3_SECRET_ACCESS_KEY: "s",
};

describe("isDeployedEnvironment", () => {
  it("treats a Vercel preview as deployed, not as local dev", () => {
    // A preview URL is publicly reachable, so it must be gated like production.
    expect(isDeployedEnvironment(preview)).toBe(true);
    expect(isDeployedEnvironment(deployed)).toBe(true);
    expect(isDeployedEnvironment(local)).toBe(false);
  });
});

describe("isMerchantApiEnabled", () => {
  it("stays on locally so the demo flow works without configuration", () => {
    expect(isMerchantApiEnabled(local)).toBe(true);
  });

  it("is off by default anywhere the internet can reach it", () => {
    expect(isMerchantApiEnabled(deployed)).toBe(false);
    expect(isMerchantApiEnabled(preview)).toBe(false);
  });

  it("can be switched on deliberately in a deployment", () => {
    expect(isMerchantApiEnabled({ ...deployed, MERCHANT_API_ENABLED: "true" })).toBe(true);
    expect(isMerchantApiEnabled({ ...deployed, MERCHANT_API_ENABLED: "TRUE" })).toBe(true);
  });

  it("fails closed on anything that is not exactly true", () => {
    // A typo or a truthy-looking value must not open an unauthenticated endpoint.
    for (const flag of ["1", "yes", "on", "", "  ", "ture"]) {
      expect(isMerchantApiEnabled({ ...deployed, MERCHANT_API_ENABLED: flag })).toBe(false);
    }
  });

  it("can be switched off locally too", () => {
    expect(isMerchantApiEnabled({ ...local, MERCHANT_API_ENABLED: "false" })).toBe(false);
  });
});

describe("missingProductionConfig", () => {
  it("asks for nothing in local dev", () => {
    expect(missingProductionConfig(local)).toEqual([]);
  });

  it("reports every missing key at once, not one per deploy", () => {
    const missing = missingProductionConfig(deployed);
    expect(missing).toContain("DATABASE_URL");
    expect(missing).toContain("S3_BUCKET");
    expect(missing.length).toBeGreaterThan(3);
  });

  it("passes when a deployment is fully configured", () => {
    expect(missingProductionConfig({ ...deployed, ...fullConfig })).toEqual([]);
  });

  it("treats inbound email as all-or-nothing", () => {
    // Half-configured inbound email would mean a webhook reachable without
    // both credentials set — an open ingestion endpoint.
    const half = { ...deployed, ...fullConfig, POSTMARK_WEBHOOK_USERNAME: "u" };
    expect(missingProductionConfig(half)).toEqual([
      "POSTMARK_WEBHOOK_PASSWORD",
      "POSTMARK_INBOUND_ADDRESS",
    ]);
  });

  it("accepts inbound email fully configured", () => {
    const full = {
      ...deployed,
      ...fullConfig,
      POSTMARK_WEBHOOK_USERNAME: "u",
      POSTMARK_WEBHOOK_PASSWORD: "p",
      POSTMARK_INBOUND_ADDRESS: "a@b.example",
    };
    expect(missingProductionConfig(full)).toEqual([]);
  });
});
