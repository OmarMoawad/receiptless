/**
 * Phase 2 session 7, step 4 — the seam a rate provider plugs into.
 *
 * **No provider is configured, and that is the current state of the
 * session rather than an oversight.** Steps 1–3 (the rate table, manual
 * entry, and a visible unavailable state) are built and work end to end
 * with no third party at all. Choosing a provider is step 4 and it
 * **needs Omar**, because it is a licensing decision rather than an
 * engineering one.
 *
 * **What decides it is EGP, and it eliminates the obvious answer.** The
 * natural free choice is Frankfurter — ECB-backed, no API key, no signup
 * and no card, which matters because Vercel already rejected the prepaid
 * and virtual cards reachable from Egypt. But the ECB's reference rates
 * **do not include EGP**, which is the currency this app most needs. So
 * the shortlist is providers with EGP *history*, where free tiers
 * typically either forbid commercial use or withhold historical data.
 *
 * Do not pick one from memory when the time comes: terms and pricing move,
 * and the shortlist has to be checked against current terms for EGP
 * historical coverage and commercial use at the moment of choosing.
 *
 * When a provider does land, it implements this interface and nothing
 * above it changes — a fetched rate is stored in `FxRate` exactly like a
 * manual one, and the snapshot on the receipt is identical in shape.
 */

export type FxRateQuote = {
  /** Quote units per one base unit, canonical decimal text. */
  rate: string;
  /** The date the rate applies to, which may not be the date requested. */
  effectiveDate: Date;
  /** Whatever identifies this quote in the provider's own records. */
  providerReference?: string;
};

export interface FxRateProvider {
  /** Stored as `FxRate.source`. Stable — it appears in every snapshot. */
  readonly id: string;
  /** Bumped when the provider's own series or terms change materially. */
  readonly policyVersion: string;
  fetchRate(base: string, quote: string, on: Date): Promise<FxRateQuote | null>;
}

/** Manual entry is tenant data, not a provider — but it needs a source id. */
export const MANUAL_SOURCE = "manual";
export const MANUAL_POLICY_VERSION = "manual-entry@1";

/**
 * The configured provider, or null while step 4 is outstanding.
 *
 * Deliberately a function rather than a constant so that adding a provider
 * is one edit here, and so that every caller already handles null — which
 * is the same code path as "this provider has no rate for that day", and
 * therefore a path that stays exercised rather than rotting.
 */
export function configuredProvider(): FxRateProvider | null {
  return null;
}
