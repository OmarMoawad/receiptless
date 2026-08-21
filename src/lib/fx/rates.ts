import { prisma } from "../db";
import { parseRate } from "./convert";
import { minorUnitScale } from "./currency-metadata";
import { MANUAL_POLICY_VERSION, MANUAL_SOURCE, configuredProvider, type FxRateProvider } from "./provider";

/**
 * Phase 2 session 7. Choosing *which* rate applies, deterministically.
 *
 * The rule the snapshot contract sets: an owner's manual rate first, then
 * the configured provider — and **reject an ambiguous key rather than
 * choosing whichever row was fetched last.** Two partial unique indexes
 * (see the migration) make the ambiguous case unrepresentable for a
 * single source; this module still checks, because an index that is
 * assumed rather than verified is an index that gets dropped by a later
 * migration without anyone noticing.
 */

/**
 * Bump when the *selection* rules change — precedence, or the lookback
 * below. This is separate from the conversion policy because a change
 * here changes which rate was chosen, not how the arithmetic was done,
 * and a snapshot needs to be able to say which of the two moved.
 */
export const RESOLVER_POLICY_VERSION = "fx-resolver@1";

/**
 * How far back the resolver will reach for a rate when the purchase date
 * itself has none.
 *
 * Some lookback is necessary rather than convenient: published series
 * have no weekend or holiday entries, so an exact-date-only rule would
 * refuse to convert a Saturday purchase forever. Seven days covers a long
 * bank holiday and nothing more — beyond that the rate is stale enough
 * that refusing is the more honest answer, and the receipt shows an
 * unavailable state instead of a confident wrong number.
 *
 * The rate actually used records its own `effectiveDate` in the snapshot,
 * so a conversion that reached back is visible as such rather than
 * looking like an exact-day match.
 */
export const MAX_RATE_LOOKBACK_DAYS = 7;

export type ResolvedRate = {
  rate: string;
  source: string;
  sourcePolicyVersion: string;
  effectiveDate: Date;
  fxRateId: string;
  /** True when no rate existed for the requested day itself. */
  reachedBack: boolean;
};

export class AmbiguousRateError extends Error {
  constructor(base: string, quote: string, on: Date, count: number) {
    super(
      `Found ${count} active rates for ${base}/${quote} on ${on.toISOString().slice(0, 10)}. ` +
        `Refusing to choose one — see the partial unique indexes in the fx_rates migration.`,
    );
    this.name = "AmbiguousRateError";
  }
}

function utcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/**
 * Records a manual rate for one owner, as an append-only correction.
 *
 * A correction never updates a row. It supersedes the previous active one
 * and inserts a replacement that names it, so "what did this app believe
 * this rate was in March?" stays answerable after the belief changes.
 * Both writes are one transaction, because a superseded row with no
 * replacement is a currency pair that silently stops converting.
 */
export async function recordManualRate(input: {
  ownerId: string;
  base: string;
  quote: string;
  effectiveDate: Date;
  rate: string;
  actorUserId: string;
  reason?: string;
}): Promise<{ id: string; supersededId: string | null }> {
  const base = input.base.trim().toUpperCase();
  const quote = input.quote.trim().toUpperCase();

  // Both currencies must have a known minor-unit scale, or a conversion
  // built on this rate could not be reproduced later.
  minorUnitScale(base);
  minorUnitScale(quote);

  // Rejects a non-canonical, non-positive or over-precise rate before any
  // row is written, rather than coercing it.
  const rate = parseRate(input.rate).text;
  const effectiveDate = utcDay(input.effectiveDate);

  return prisma.$transaction(async (tx) => {
    const existing = await tx.fxRate.findFirst({
      where: { ownerId: input.ownerId, base, quote, effectiveDate, supersededAt: null },
    });

    if (existing) {
      await tx.fxRate.update({ where: { id: existing.id }, data: { supersededAt: new Date() } });
    }

    const created = await tx.fxRate.create({
      data: {
        ownerId: input.ownerId,
        base,
        quote,
        effectiveDate,
        rate,
        source: MANUAL_SOURCE,
        sourcePolicyVersion: MANUAL_POLICY_VERSION,
        enteredAt: new Date(),
        actorUserId: input.actorUserId,
        reason: input.reason,
        supersedesId: existing?.id ?? null,
      },
    });

    return { id: created.id, supersededId: existing?.id ?? null };
  });
}

async function activeRatesFor(where: {
  ownerId: string | null;
  base: string;
  quote: string;
  from: Date;
  to: Date;
  source?: string;
}) {
  return prisma.fxRate.findMany({
    where: {
      ownerId: where.ownerId,
      base: where.base,
      quote: where.quote,
      supersededAt: null,
      effectiveDate: { gte: where.from, lte: where.to },
      ...(where.source ? { source: where.source } : {}),
    },
    orderBy: { effectiveDate: "desc" },
  });
}

/**
 * The rate to use for a purchase, or null when there is none.
 *
 * Null is a first-class outcome, not an error: it is what step 3's
 * visible "rate unavailable" state renders, and it is the honest answer
 * whenever no provider is configured and the owner has entered nothing.
 */
export async function resolveRate(
  input: {
    ownerId: string;
    base: string;
    quote: string;
    on: Date;
  },
  // Injectable so tests supply a fake and never reach the network — the
  // same seam recordManualRate's callers use. Defaults to whatever the
  // environment configured (null when nothing is).
  provider: FxRateProvider | null = configuredProvider(),
): Promise<ResolvedRate | null> {
  const base = input.base.trim().toUpperCase();
  const quote = input.quote.trim().toUpperCase();
  const on = utcDay(input.on);
  const from = new Date(on.getTime() - MAX_RATE_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

  const pick = (rows: Awaited<ReturnType<typeof activeRatesFor>>): ResolvedRate | null => {
    if (rows.length === 0) return null;

    // Ambiguity is only ambiguity within one effective date. An older row
    // losing to a newer one is precedence, not a conflict.
    const newest = rows[0].effectiveDate.getTime();
    const tied = rows.filter((row) => row.effectiveDate.getTime() === newest);
    if (tied.length > 1) throw new AmbiguousRateError(base, quote, on, tied.length);

    const row = tied[0];
    return {
      rate: row.rate,
      source: row.source,
      sourcePolicyVersion: row.sourcePolicyVersion,
      effectiveDate: row.effectiveDate,
      fxRateId: row.id,
      reachedBack: row.effectiveDate.getTime() !== on.getTime(),
    };
  };

  // Precedence: the owner's own rate always wins. Someone who has entered
  // the rate their bank actually charged should never have that silently
  // replaced by a reference rate that disagrees.
  const manual = pick(await activeRatesFor({ ownerId: input.ownerId, base, quote, from, to: on }));
  if (manual) return manual;

  if (!provider) return null;

  // A rate this provider has already fetched is reused rather than fetched
  // again — the fetch is the expensive, billable, rate-limited part, and
  // the whole point of `fx_rates` is that each (source, pair, date) is
  // paid for once. A rate the provider fetched for an earlier request, or
  // one it reached back to over a weekend, is found here.
  const cached = pick(await activeRatesFor({ ownerId: null, base, quote, from, to: on, source: provider.id }));
  if (cached) return cached;

  // Nothing on file — ask the provider, and persist what it returns so the
  // next resolve for this pair is a table read, not another fetch. This is
  // the wiring that makes configuring a provider actually do something;
  // without it the provider is built but never called.
  const fetched = await provider.fetchRate(base, quote, on);
  if (!fetched) return null;

  const stored = await persistProviderRate(provider, base, quote, fetched);
  return {
    rate: stored.rate,
    source: stored.source,
    sourcePolicyVersion: stored.sourcePolicyVersion,
    effectiveDate: stored.effectiveDate,
    fxRateId: stored.id,
    reachedBack: stored.effectiveDate.getTime() !== on.getTime(),
  };
}

/**
 * Writes a provider-fetched rate into `fx_rates`, keyed by the date the
 * provider says it is *effective* — which may be earlier than the date
 * asked for, when the provider reached back over a non-trading day. The
 * effective date is what the snapshot and every later lookup key on, so it
 * is what gets stored.
 *
 * Two fetches for the same pair and date can race — the ingestion paths
 * that call this run per receipt. The partial unique index on active
 * provider rows makes the second write fail rather than duplicate; that
 * failure is caught and the row the winner wrote is read back, so a race
 * resolves to one shared rate instead of an error.
 */
async function persistProviderRate(
  provider: FxRateProvider,
  base: string,
  quote: string,
  fetched: { rate: string; effectiveDate: Date; providerReference?: string },
): Promise<{
  id: string;
  rate: string;
  source: string;
  sourcePolicyVersion: string;
  effectiveDate: Date;
}> {
  // Validate the provider's rate the same way a manual one is validated,
  // rather than trusting it: a non-canonical or non-positive rate is a bug
  // in the adapter, and it should fail loudly here, not be stored.
  const rate = parseRate(fetched.rate).text;
  const effectiveDate = utcDay(fetched.effectiveDate);

  const row = {
    ownerId: null,
    base,
    quote,
    effectiveDate,
    rate,
    source: provider.id,
    sourcePolicyVersion: provider.policyVersion,
    fetchedAt: new Date(),
    providerReference: fetched.providerReference ?? null,
  };

  try {
    const created = await prisma.fxRate.create({ data: row });
    return {
      id: created.id,
      rate: created.rate,
      source: created.source,
      sourcePolicyVersion: created.sourcePolicyVersion,
      effectiveDate: created.effectiveDate,
    };
  } catch (error) {
    if (!isUniqueConflict(error)) throw error;

    // Lost the race: another request stored this exact (source, pair,
    // effective date). Read that winner back and use it, so both requests
    // agree on one rate.
    const existing = await prisma.fxRate.findFirst({
      where: { ownerId: null, base, quote, effectiveDate, source: provider.id, supersededAt: null },
    });
    if (!existing) throw error;
    return {
      id: existing.id,
      rate: existing.rate,
      source: existing.source,
      sourcePolicyVersion: existing.sourcePolicyVersion,
      effectiveDate: existing.effectiveDate,
    };
  }
}

/** A Prisma unique-constraint violation, without importing the enum shape. */
function isUniqueConflict(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002";
}
