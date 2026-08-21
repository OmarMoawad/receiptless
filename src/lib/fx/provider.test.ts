import { afterEach, describe, expect, it } from "vitest";
import { configuredProvider } from "./provider";
import { ApifyCbeProvider } from "./providers/apify-cbe";

/**
 * `configuredProvider()` reads the environment, so each case sets exactly
 * the variables it needs and clears them again. The default — nothing set
 * — must stay null, because that is the state every other test in the repo
 * relies on to mean "manual entry only".
 */
const KEYS = ["FX_PROVIDER", "APIFY_TOKEN", "APIFY_CBE_ACTOR", "FX_CBE_RATE_SIDE"] as const;

afterEach(() => {
  for (const key of KEYS) delete process.env[key];
});

describe("configuredProvider", () => {
  it("is null when nothing is configured — the default everywhere", () => {
    expect(configuredProvider()).toBeNull();
  });

  it("is null when the switch is off, even if a token is present", () => {
    process.env.APIFY_TOKEN = "tok";
    expect(configuredProvider()).toBeNull();
  });

  it("fails to null when the switch is on but the token is missing", () => {
    // A half-set configuration must not half-work: no token, no provider.
    process.env.FX_PROVIDER = "apify-cbe";
    expect(configuredProvider()).toBeNull();
  });

  it("builds the CBE provider when switch and token are both set", () => {
    process.env.FX_PROVIDER = "apify-cbe";
    process.env.APIFY_TOKEN = "tok";
    const provider = configuredProvider();
    expect(provider).toBeInstanceOf(ApifyCbeProvider);
    expect(provider?.id).toBe("apify-cbe");
    // Default side is mid.
    expect(provider?.policyVersion).toBe("cbe-mid@1");
  });

  it("carries the chosen side into the policy version", () => {
    process.env.FX_PROVIDER = "apify-cbe";
    process.env.APIFY_TOKEN = "tok";
    process.env.FX_CBE_RATE_SIDE = "buy";
    expect(configuredProvider()?.policyVersion).toBe("cbe-buy@1");
  });

  it("treats an unrecognised side as mid rather than failing", () => {
    process.env.FX_PROVIDER = "apify-cbe";
    process.env.APIFY_TOKEN = "tok";
    process.env.FX_CBE_RATE_SIDE = "nonsense";
    expect(configuredProvider()?.policyVersion).toBe("cbe-mid@1");
  });
});
