import { ApifyCbeProvider } from "./providers/apify-cbe";

/**
 * Phase 2 session 7, step 4 — the seam a rate provider plugs into.
 *
 * **The Central Bank of Egypt provider is wired (2026-08-21), and it is
 * off unless configured.** The decision that chose it was EGP: the natural
 * free choice, Frankfurter, is ECB-backed and excludes EGP, which is the
 * currency this app most needs. The shortlist of providers with EGP
 * *history* mostly forbid commercial use or withhold history on their free
 * tiers — so the route that survived is CBE's own published rates, read
 * through an Apify actor, on Apify's free plan. See
 * `docs/fx-provider-comparison.md` for the comparison and
 * `docs/SETUP-ACCOUNTS.md` for how it is turned on.
 *
 * A provider implements the interface below and nothing above it changes —
 * a fetched rate is stored in `FxRate` exactly like a manual one, and the
 * snapshot on the receipt is identical in shape. `configuredProvider()`
 * returns null when nothing is set, which is manual-entry-only and the
 * same code path a configured provider takes when it has no rate for a
 * given day.
 */

export type FxRateQuote = {
  /** Quote units per one base unit, canonical decimal text. */
  rate: string;
  /** The date the rate applies to, which may not be the date requested. */
  effectiveDate: Date;
  /** Whatever identifies this quote in the provider's own records. */
  providerReference?: string;
};

/**
 * The inclusive date range a provider may answer from, `[from, on]`.
 *
 * The resolver is the authority on the lookback (see `MAX_RATE_LOOKBACK_DAYS`
 * in `rates.ts`) — the provider is told the whole window and returns the
 * newest valid rate inside it, in one request, rather than being asked one
 * date at a time and made to retry over each weekend and holiday. `on` is
 * the purchase date; `from` is the earliest effective date the resolver will
 * accept. A row outside `[from, on]` is not this window's answer.
 */
export type FxRateWindow = { from: Date; on: Date };

export interface FxRateProvider {
  /** Stored as `FxRate.source`. Stable — it appears in every snapshot. */
  readonly id: string;
  /** Bumped when the provider's own series or terms change materially. */
  readonly policyVersion: string;
  fetchRate(base: string, quote: string, window: FxRateWindow): Promise<FxRateQuote | null>;
}

/** Manual entry is tenant data, not a provider — but it needs a source id. */
export const MANUAL_SOURCE = "manual";
export const MANUAL_POLICY_VERSION = "manual-entry@1";

/**
 * The configured provider, or null when none is set.
 *
 * `FX_PROVIDER` is the switch. Unset — the default, and the state in every
 * test and in local dev — returns null, which is manual-entry-only and the
 * *same* code path that runs when a configured provider simply has no rate
 * for a day. So the null path stays exercised rather than rotting, and a
 * half-set configuration fails to null rather than half-working.
 *
 * The only wired provider is the Central Bank of Egypt one (session 7 step
 * 4). It reads its actor and rate-side from the environment so that
 * switching either is a config change, not a deploy of new code — and the
 * side travels into `policyVersion`, so a change from mid to buy/sell is a
 * new version rather than a silent restatement of stored rates.
 */
export function configuredProvider(): FxRateProvider | null {
  if (process.env.FX_PROVIDER !== "apify-cbe") return null;

  const token = process.env.APIFY_TOKEN?.trim();
  if (!token) return null;

  const side = normaliseSide(process.env.FX_CBE_RATE_SIDE);
  const actor = process.env.APIFY_CBE_ACTOR?.trim() || undefined;

  return new ApifyCbeProvider({ token, actor, side });
}

function normaliseSide(value: string | undefined): "buy" | "sell" | "mid" {
  const side = value?.trim().toLowerCase();
  if (side === "buy" || side === "sell") return side;
  // Default to mid — Omar's choice on 2026-08-21, and the neutral one.
  return "mid";
}
