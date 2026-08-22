import type { FxRateProvider, FxRateQuote, FxRateWindow } from "../provider";

/**
 * Phase 2 session 7, step 4 — the Central Bank of Egypt rate provider.
 *
 * Chosen over every commercial aggregator because receiptless's output is
 * a tax summary filed in Egypt, where the CBE rate is the one that
 * belongs on a return, not a mid-market aggregate (see
 * `docs/fx-provider-comparison.md`). CBE has no public API and blocks
 * scrapers, so the only reachable route is a community-maintained Apify
 * actor that reads CBE's own published rates. The data is official; the
 * tool around it is not, and that risk is bounded by design — rates are
 * snapshotted onto receipts, so if this actor ever disappears no recorded
 * figure moves, new automatic conversions stop, and manual entry still
 * works.
 *
 * The actor's real contract, read from the running actor on 2026-08-21:
 *
 *   input  { currencies: ["USD"], fromDate: "DD/MM/YYYY", toDate,
 *            includeConversionRate, includeBuySell, includeCrossRates }
 *   output [{ date: "DD/MM/YYYY", base, base_name, target, target_name,
 *             buy, sell, conversion_rate }]
 *
 * Requesting one currency returns **both directions** against EGP, so a
 * single fetch covers whichever way the pair runs.
 */

const DEFAULT_ACTOR = "maged120/central-bank-of-egypt-historical-rates";

/** Which published rate to snapshot. Omar chose `mid` (2026-08-21). */
export type CbeRateSide = "buy" | "sell" | "mid";

/** The field on a CBE row that each side reads. */
const SIDE_FIELD: Record<CbeRateSide, "buy" | "sell" | "conversion_rate"> = {
  buy: "buy",
  sell: "sell",
  mid: "conversion_rate",
};

export type CbeRow = {
  date: string;
  base: string;
  base_name?: string;
  target: string;
  target_name?: string;
  buy?: number;
  sell?: number;
  conversion_rate?: number;
};

/** `2026-03-05` (UTC) → `05/03/2026`, the format the actor's input wants. */
export function toCbeDate(date: Date): string {
  const d = String(date.getUTCDate()).padStart(2, "0");
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${d}/${m}/${date.getUTCFullYear()}`;
}

/** `05/03/2026` → a UTC Date at midnight. Null on anything malformed. */
export function fromCbeDate(value: string): Date | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim());
  if (!match) return null;
  const [, dd, mm, yyyy] = match;
  const date = new Date(Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd)));
  // Reject a date the components did not actually form (e.g. 31/02): the
  // round-trip back to components must match.
  if (
    date.getUTCFullYear() !== Number(yyyy) ||
    date.getUTCMonth() !== Number(mm) - 1 ||
    date.getUTCDate() !== Number(dd)
  ) {
    return null;
  }
  return date;
}

/**
 * A CBE rate as a **number** becomes a canonical decimal **string**, or
 * null if it cannot be represented safely.
 *
 * The provider hands out JSON numbers — doubles — and the rest of this
 * subsystem refuses to let a rate be a double (see `decimal.ts`). The
 * bridge is narrow and only safe because CBE's precision is bounded: it
 * publishes at four decimal places, so `String(n)` returns the shortest
 * decimal that round-trips, which *is* the published value exactly. A
 * value large or small enough to serialise in exponential form is outside
 * that assumption and is refused rather than guessed at — the receipt
 * then shows the unavailable state and manual entry still works.
 *
 * A provider with more precision than this one would need the raw numeric
 * token pulled from the response text before JSON parsing turned it into
 * a double. CBE does not, so this stays simple and says why.
 */
export function cbeRateToCanonicalString(value: number | undefined): string | null {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return null;
  const text = String(value);
  if (/[eE]/.test(text)) return null;
  return text;
}

/**
 * The pure half of the provider: given the actor's rows for a date range,
 * pick the newest valid one for this exact pair and turn it into a quote.
 * Separated from the network so it can be tested against real captured
 * payloads without a token.
 *
 * A range request answers a weekend or holiday purchase in one call: asking
 * for Friday–Sunday returns Friday's published row, and this selects it by
 * **greatest effective date within the window**, not by the actor's row
 * order. A row for the pair but dated outside `[window.from, window.on]` —
 * or one whose rate or date will not parse — is skipped rather than trusted,
 * so the resolver never persists a rate from beyond the lookback it set.
 */
export function quoteFromRows(
  rows: CbeRow[],
  base: string,
  quote: string,
  side: CbeRateSide,
  window: FxRateWindow,
): FxRateQuote | null {
  const wantBase = base.trim().toUpperCase();
  const wantQuote = quote.trim().toUpperCase();
  const field = SIDE_FIELD[side];
  const floor = window.from.getTime();
  const ceil = window.on.getTime();

  let best: { rate: string; effectiveDate: Date; date: string } | null = null;
  for (const candidate of rows) {
    if (
      candidate.base?.trim().toUpperCase() !== wantBase ||
      candidate.target?.trim().toUpperCase() !== wantQuote
    ) {
      continue;
    }

    const rate = cbeRateToCanonicalString(candidate[field]);
    const effectiveDate = fromCbeDate(candidate.date);
    if (!rate || !effectiveDate) continue;

    // Reject anything outside the window the resolver asked for, in either
    // direction: a stale row before the floor, or a future row after the
    // purchase date, is not this window's answer.
    const time = effectiveDate.getTime();
    if (time < floor || time > ceil) continue;

    if (!best || time > best.effectiveDate.getTime()) {
      best = { rate, effectiveDate, date: candidate.date };
    }
  }

  if (!best) return null;

  return {
    rate: best.rate,
    effectiveDate: best.effectiveDate,
    providerReference: `cbe:${best.date}:${wantBase}/${wantQuote}:${side}`,
  };
}

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export class ApifyCbeProvider implements FxRateProvider {
  readonly id = "apify-cbe";
  /**
   * The side is part of the policy, so a later switch from mid to buy/sell
   * is a new version rather than a silent restatement of stored rates.
   */
  readonly policyVersion: string;

  private readonly token: string;
  private readonly actor: string;
  private readonly side: CbeRateSide;
  private readonly fetchImpl: FetchLike;

  constructor(options: {
    token: string;
    actor?: string;
    side?: CbeRateSide;
    fetchImpl?: FetchLike;
  }) {
    this.token = options.token;
    this.actor = options.actor ?? DEFAULT_ACTOR;
    this.side = options.side ?? "mid";
    this.fetchImpl = options.fetchImpl ?? ((url, init) => fetch(url, init));
    this.policyVersion = `cbe-${this.side}@1`;
  }

  async fetchRate(base: string, quote: string, window: FxRateWindow): Promise<FxRateQuote | null> {
    const wantBase = base.trim().toUpperCase();
    const wantQuote = quote.trim().toUpperCase();

    // CBE quotes everything against EGP. When one side is EGP, request the
    // other currency and both directions come back. When neither is EGP,
    // the pair is a cross rate, which the actor only returns with cross
    // rates enabled — and if it still isn't present, null is the honest
    // answer, handled downstream as the unavailable state.
    const crossRate = wantBase !== "EGP" && wantQuote !== "EGP";
    const requested = crossRate ? [wantBase, wantQuote] : [wantBase === "EGP" ? wantQuote : wantBase];

    // One inclusive range request across the whole lookback window, so a
    // Sunday or holiday purchase discovers Friday's rate in a single call
    // rather than an eight-request retry loop.
    const input = {
      currencies: requested,
      fromDate: toCbeDate(window.from),
      toDate: toCbeDate(window.on),
      includeConversionRate: this.side === "mid",
      includeBuySell: this.side !== "mid",
      includeCrossRates: crossRate,
    };

    // The actor id is `owner/name` for humans and `owner~name` in the API
    // path; accept the friendly form in config and convert here.
    const path = this.actor.replace("/", "~");
    const url = `https://api.apify.com/v2/acts/${path}/run-sync-get-dataset-items`;

    // The token travels in the Authorization header, never the URL: a URL is
    // logged by proxies, error trackers and the browser's own history, and a
    // token that reaches any of those is a leaked credential. Apify accepts
    // `Bearer <token>`.
    const response = await this.fetchImpl(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.token}`,
      },
      body: JSON.stringify(input),
    });

    if (!response.ok) {
      throw new Error(`CBE rate actor returned ${response.status} ${response.statusText}`);
    }

    const rows = (await response.json()) as CbeRow[];
    if (!Array.isArray(rows)) return null;

    return quoteFromRows(rows, wantBase, wantQuote, this.side, window);
  }
}
