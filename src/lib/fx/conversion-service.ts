import { prisma } from "../db";
import { convertAmount } from "./convert";
import { UnknownCurrencyError, isKnownCurrency } from "./currency-metadata";
import { RESOLVER_POLICY_VERSION, resolveRate } from "./rates";

/**
 * Phase 2 session 7. Attaching an immutable conversion to a receipt.
 *
 * The requirement in one sentence: **the receipt copies the rate, it does
 * not look it up.** Every field needed to reproduce the arithmetic is
 * duplicated onto the snapshot on purpose, so a revised series, a
 * corrected rate, or a provider disappearing entirely can never
 * retroactively change what a past purchase cost. `fxRateId` is kept as
 * provenance, not as a dependency — nothing reads through it to convert.
 *
 * Corrections are versions rather than edits. `reprocessConversion` is
 * the only way a receipt's converted total changes, it is explicit, and
 * it retains every prior version with lineage. **No background refresh
 * may do this**, which is why nothing here is called from a cron or a
 * sync path.
 */

export type ConversionSnapshot = {
  id: string;
  version: number;
  sourceCurrency: string;
  targetCurrency: string;
  totalTargetMinor: number;
  rate: string;
  rateSource: string;
  rateEffectiveDate: Date;
  unroundedResult: string;
};

export type ConversionState =
  /** Already in the reporting currency. Converting would be a no-op. */
  | { status: "same-currency"; currency: string }
  | { status: "converted"; snapshot: ConversionSnapshot }
  /**
   * Step 3's visible state. The number is not known, and saying so is the
   * whole point — substituting today's rate would put a confident wrong
   * figure in someone's tax return.
   */
  | { status: "unavailable"; sourceCurrency: string; targetCurrency: string; reason: string };

function toSnapshot(row: {
  id: string;
  version: number;
  sourceCurrency: string;
  targetCurrency: string;
  totalTargetMinor: number;
  rate: string;
  rateSource: string;
  rateEffectiveDate: Date;
  unroundedResult: string;
}): ConversionSnapshot {
  return {
    id: row.id,
    version: row.version,
    sourceCurrency: row.sourceCurrency,
    targetCurrency: row.targetCurrency,
    totalTargetMinor: row.totalTargetMinor,
    rate: row.rate,
    rateSource: row.rateSource,
    rateEffectiveDate: row.rateEffectiveDate,
    unroundedResult: row.unroundedResult,
  };
}

export async function approvedConversion(receiptId: string): Promise<ConversionSnapshot | null> {
  const row = await prisma.receiptConversion.findFirst({ where: { receiptId, approved: true } });
  return row ? toSnapshot(row) : null;
}

/**
 * Ensures a receipt has an approved conversion into its owner's reporting
 * currency, and reports what happened.
 *
 * Idempotent by design: called again it returns the existing snapshot
 * untouched rather than re-converting. That is what makes it safe to call
 * from every ingestion path — the manual form, the inbound mailbox, the
 * Gmail scan, the merchant API — without any of them having to know
 * whether another one got there first.
 */
export async function captureConversion(receiptId: string): Promise<ConversionState> {
  const receipt = await prisma.receipt.findUnique({
    where: { id: receiptId },
    include: { owner: true },
  });

  // An unclaimed merchant-pushed receipt has no owner and therefore no
  // reporting currency to convert into. It converts when it is claimed.
  if (!receipt?.owner) {
    return {
      status: "unavailable",
      sourceCurrency: receipt?.currency ?? "",
      targetCurrency: "",
      reason: "This receipt has no owner yet, so there is no reporting currency to convert into.",
    };
  }

  const sourceCurrency = receipt.currency.trim().toUpperCase();
  const targetCurrency = receipt.owner.reportingCurrency.trim().toUpperCase();

  if (sourceCurrency === targetCurrency) return { status: "same-currency", currency: targetCurrency };

  const existing = await approvedConversion(receiptId);
  if (existing) return { status: "converted", snapshot: existing };

  if (!isKnownCurrency(sourceCurrency) || !isKnownCurrency(targetCurrency)) {
    return {
      status: "unavailable",
      sourceCurrency,
      targetCurrency,
      reason: `No minor-unit scale is known for ${
        isKnownCurrency(sourceCurrency) ? targetCurrency : sourceCurrency
      }, so an amount in it cannot be converted reproducibly.`,
    };
  }

  const resolved = await resolveRate({
    ownerId: receipt.owner.id,
    base: sourceCurrency,
    quote: targetCurrency,
    on: receipt.purchasedAt,
  });

  if (!resolved) {
    return {
      status: "unavailable",
      sourceCurrency,
      targetCurrency,
      reason: `No ${sourceCurrency}/${targetCurrency} rate is on file for ${
        receipt.purchasedAt.toISOString().slice(0, 10)
      }. Enter the rate your bank charged, and the conversion is stored against this receipt permanently.`,
    };
  }

  const converted = convertAmount({
    sourceMinor: receipt.totalMinor,
    sourceCurrency,
    targetCurrency,
    rate: resolved.rate,
  });

  const created = await prisma.receiptConversion.create({
    data: {
      receiptId,
      version: 1,
      approved: true,
      sourceCurrency: converted.sourceCurrency,
      targetCurrency: converted.targetCurrency,
      sourceScale: converted.sourceScale,
      targetScale: converted.targetScale,
      currencyMetadataVersion: converted.currencyMetadataVersion,
      rate: converted.rate,
      rateSource: resolved.source,
      rateEffectiveDate: resolved.effectiveDate,
      // Both policies travel: one says how the rate was *chosen*, the
      // other how the arithmetic was *done*, and a later change to either
      // must be attributable to the right one.
      ratePolicyVersion: `${resolved.sourcePolicyVersion}+${RESOLVER_POLICY_VERSION}`,
      conversionPolicyVersion: converted.conversionPolicyVersion,
      unroundedResult: converted.unroundedResult,
      totalTargetMinor: converted.targetMinor,
      fxRateId: resolved.fxRateId,
    },
  });

  return { status: "converted", snapshot: toSnapshot(created) };
}

/**
 * The explicit, authorised reprocessing operation.
 *
 * Deliberately not automatic and deliberately not an update. It creates a
 * new version with lineage back to the one it replaces, moves approval,
 * and retains everything prior — so a corrected rate produces a second
 * answer that can be compared with the first, rather than quietly
 * replacing a number someone may already have filed a return on.
 *
 * The unapprove and the insert are one transaction because the partial
 * unique index permits exactly one approved version per receipt: doing
 * them separately would either collide or leave the receipt with none.
 */
export async function reprocessConversion(
  receiptId: string,
  context: { operator: string; reason: string; correlationId?: string },
): Promise<ConversionState> {
  const receipt = await prisma.receipt.findUnique({ where: { id: receiptId }, include: { owner: true } });
  if (!receipt?.owner) throw new Error(`Receipt ${receiptId} has no owner to reprocess against.`);

  const current = await prisma.receiptConversion.findFirst({ where: { receiptId, approved: true } });
  if (!current) throw new Error(`Receipt ${receiptId} has no approved conversion to reprocess.`);

  const sourceCurrency = receipt.currency.trim().toUpperCase();
  const targetCurrency = receipt.owner.reportingCurrency.trim().toUpperCase();

  const resolved = await resolveRate({
    ownerId: receipt.owner.id,
    base: sourceCurrency,
    quote: targetCurrency,
    on: receipt.purchasedAt,
  });
  if (!resolved) {
    return {
      status: "unavailable",
      sourceCurrency,
      targetCurrency,
      reason: "No rate is on file to reprocess with; the existing conversion is left approved and unchanged.",
    };
  }

  const converted = convertAmount({
    sourceMinor: receipt.totalMinor,
    sourceCurrency,
    targetCurrency,
    rate: resolved.rate,
  });

  const highest = await prisma.receiptConversion.findFirst({
    where: { receiptId },
    orderBy: { version: "desc" },
    select: { version: true },
  });

  const created = await prisma.$transaction(async (tx) => {
    await tx.receiptConversion.update({ where: { id: current.id }, data: { approved: false } });
    return tx.receiptConversion.create({
      data: {
        receiptId,
        version: (highest?.version ?? current.version) + 1,
        parentId: current.id,
        approved: true,
        sourceCurrency: converted.sourceCurrency,
        targetCurrency: converted.targetCurrency,
        sourceScale: converted.sourceScale,
        targetScale: converted.targetScale,
        currencyMetadataVersion: converted.currencyMetadataVersion,
        rate: converted.rate,
        rateSource: resolved.source,
        rateEffectiveDate: resolved.effectiveDate,
        ratePolicyVersion: `${resolved.sourcePolicyVersion}+${RESOLVER_POLICY_VERSION}`,
        conversionPolicyVersion: converted.conversionPolicyVersion,
        unroundedResult: converted.unroundedResult,
        totalTargetMinor: converted.targetMinor,
        fxRateId: resolved.fxRateId,
        operator: context.operator,
        reason: context.reason,
        correlationId: context.correlationId,
      },
    });
  });

  return { status: "converted", snapshot: toSnapshot(created) };
}

export { UnknownCurrencyError };
