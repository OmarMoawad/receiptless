import { prisma } from "../db";
import { captureConversion, reprocessConversion } from "./conversion-service";

/**
 * Phase 2 session 8. Reconciling historical receipts into the owner's
 * *current* reporting currency, on explicit request.
 *
 * The setting that chooses a reporting currency does not, on its own, move
 * a single stored figure — that is session 7's whole discipline. This is
 * the deliberate, owner-authorised counterpart: the owner previews how many
 * past receipts are not reportable in the currency they now use, and then
 * applies the work in bounded batches. Preview reads and classifies only;
 * it never touches a provider or writes a row. Apply is the point where an
 * initial capture happens and an old-target conversion is reprocessed into
 * a new immutable version — one owner, ten receipts at a time, in a
 * deterministic order that a continuation cursor resumes.
 *
 * Every selection is scoped by `ownerId`. A request never supplies a
 * receipt id, and the cursor is only a position inside an owner-filtered
 * ordering, so a forged one cannot reach another tenant's receipts.
 */

/**
 * Where a receipt stands relative to the current reporting currency:
 *
 * - `sameCurrency`  — already in it; no conversion row is needed.
 * - `alreadyCurrent` — an approved conversion already targets it.
 * - `missing`       — no approved conversion; eligible for initial capture.
 * - `oldTarget`     — an approved conversion targets a currency the owner
 *                     has since changed away from; eligible for reprocess.
 */
export type FxReconciliationCategory = "sameCurrency" | "alreadyCurrent" | "missing" | "oldTarget";

type CategoryCounts = Record<FxReconciliationCategory, number>;

function zeroCounts(): CategoryCounts {
  return { sameCurrency: 0, alreadyCurrent: 0, missing: 0, oldTarget: 0 };
}

export type FxReconciliationSourceLine = {
  /** The receipt's own currency; the totals below are counts, not amounts. */
  sourceCurrency: string;
} & CategoryCounts;

export type FxReconciliationPreview = {
  reportingCurrency: string;
  total: number;
  categories: CategoryCounts;
  bySourceCurrency: FxReconciliationSourceLine[];
  /**
   * `missing + oldTarget` — the receipts an Apply would attempt. Named as
   * *eligible attempts*, not promised conversions: whether a rate is
   * actually available cannot be known without the provider work Apply does.
   */
  eligible: number;
};

type ReceiptRow = {
  id: string;
  currency: string;
  purchasedAt: Date;
  conversions: { targetCurrency: string; sourceCurrency: string }[];
};

/** Classify one receipt against the current reporting currency. */
function classify(receipt: ReceiptRow, reportingCurrency: string): FxReconciliationCategory {
  const source = receipt.currency.trim().toUpperCase();
  if (source === reportingCurrency) return "sameCurrency";

  const approved = receipt.conversions[0];
  if (!approved) return "missing";

  const target = approved.targetCurrency.trim().toUpperCase();
  return target === reportingCurrency ? "alreadyCurrent" : "oldTarget";
}

async function ownerReportingCurrency(ownerId: string): Promise<string> {
  const owner = await prisma.user.findUniqueOrThrow({
    where: { id: ownerId },
    select: { reportingCurrency: true },
  });
  return owner.reportingCurrency.trim().toUpperCase();
}

/**
 * A read-only summary of what reconciliation would touch, grouped by source
 * currency and by category. Makes no provider call and writes nothing —
 * asserted by the tests, because a preview that silently fetched or wrote
 * would defeat the "the setting alone moves nothing" guarantee.
 */
export async function previewFxReconciliation(ownerId: string): Promise<FxReconciliationPreview> {
  const reportingCurrency = await ownerReportingCurrency(ownerId);

  const receipts = await prisma.receipt.findMany({
    where: { ownerId },
    select: {
      id: true,
      currency: true,
      purchasedAt: true,
      conversions: { where: { approved: true }, select: { targetCurrency: true, sourceCurrency: true } },
    },
  });

  const categories = zeroCounts();
  const bySource = new Map<string, FxReconciliationSourceLine>();

  for (const receipt of receipts) {
    const category = classify(receipt, reportingCurrency);
    categories[category] += 1;

    const source = receipt.currency.trim().toUpperCase();
    const line = bySource.get(source) ?? { sourceCurrency: source, ...zeroCounts() };
    line[category] += 1;
    bySource.set(source, line);
  }

  return {
    reportingCurrency,
    total: receipts.length,
    categories,
    bySourceCurrency: [...bySource.values()].sort((a, b) =>
      a.sourceCurrency.localeCompare(b.sourceCurrency),
    ),
    eligible: categories.missing + categories.oldTarget,
  };
}

/** The owner selected a different reporting currency than the preview was run against. */
export class StaleReportingCurrencyError extends Error {
  constructor(
    public readonly expected: string,
    public readonly actual: string,
  ) {
    super(
      `Preview expected reporting currency ${expected}, but the owner now reports in ${actual}. ` +
        `Re-run the preview before applying, so nothing is reconciled to a currency they no longer use.`,
    );
    this.name = "StaleReportingCurrencyError";
  }
}

export type FxReconciliationCursor = { purchasedAt: string; id: string };

export type ApplyFxReconciliationInput = {
  cursor?: FxReconciliationCursor;
  limit: number;
  expectedReportingCurrency: string;
  correlationId: `fx-reconciliation:${string}`;
};

/** Per-batch outcomes. Sums are safe: a per-receipt failure never aborts the batch. */
export type ApplyFxReconciliationResult = {
  processed: number;
  nextCursor: FxReconciliationCursor | null;
  results: {
    converted: number;
    reprocessed: number;
    alreadyCurrent: number;
    sameCurrency: number;
    unavailable: number;
    failed: number;
  };
};

const MAX_APPLY_LIMIT = 10;

/**
 * Reconcile one bounded batch of an owner's receipts into their current
 * reporting currency, resuming from a cursor.
 *
 * Deterministic order — `(purchasedAt, id)` — so a continuation resumes
 * exactly where the previous batch stopped and the same run never processes
 * a receipt twice. Each receipt is handled sequentially: an initial capture
 * or a reprocess (which the owner's Apply is the authorisation for), both
 * carrying the run's audit context. A per-receipt error is isolated,
 * counted as `failed`, and does not stop the rest of the batch. The current
 * reporting currency is re-read and a stale preview is rejected before any
 * work, so a batch never reconciles to a currency the owner has moved off.
 */
export async function applyFxReconciliation(
  ownerId: string,
  input: ApplyFxReconciliationInput,
): Promise<ApplyFxReconciliationResult> {
  const limit = Math.min(Math.max(input.limit, 1), MAX_APPLY_LIMIT);
  const reportingCurrency = await ownerReportingCurrency(ownerId);
  const expected = input.expectedReportingCurrency.trim().toUpperCase();
  if (reportingCurrency !== expected) {
    throw new StaleReportingCurrencyError(expected, reportingCurrency);
  }

  const context = {
    operator: ownerId,
    reason: "owner-requested FX reconciliation",
    correlationId: input.correlationId,
  };

  // Keyset pagination over the deterministic order. A row is "after" the
  // cursor when its purchase date is later, or the same date with a greater
  // id — the same order the query sorts by, so nothing is skipped or seen
  // twice across batches.
  const cursorWhere = input.cursor
    ? {
        OR: [
          { purchasedAt: { gt: new Date(input.cursor.purchasedAt) } },
          {
            purchasedAt: new Date(input.cursor.purchasedAt),
            id: { gt: input.cursor.id },
          },
        ],
      }
    : {};

  const receipts = await prisma.receipt.findMany({
    where: { ownerId, ...cursorWhere },
    select: {
      id: true,
      currency: true,
      purchasedAt: true,
      conversions: { where: { approved: true }, select: { targetCurrency: true, sourceCurrency: true } },
    },
    orderBy: [{ purchasedAt: "asc" }, { id: "asc" }],
    take: limit,
  });

  const results = {
    converted: 0,
    reprocessed: 0,
    alreadyCurrent: 0,
    sameCurrency: 0,
    unavailable: 0,
    failed: 0,
  };

  for (const receipt of receipts) {
    try {
      const category = classify(receipt, reportingCurrency);

      if (category === "sameCurrency") {
        results.sameCurrency += 1;
        continue;
      }
      if (category === "alreadyCurrent") {
        results.alreadyCurrent += 1;
        continue;
      }

      const state =
        category === "oldTarget"
          ? await reprocessConversion(receipt.id, context)
          : await captureConversion(receipt.id, context);

      if (state.status === "converted") {
        results[category === "oldTarget" ? "reprocessed" : "converted"] += 1;
      } else if (state.status === "same-currency") {
        results.sameCurrency += 1;
      } else {
        // "unavailable": no rate in the window. Not a failure — the receipt
        // is left as it was and a manual rate lets a rerun pick it up.
        results.unavailable += 1;
      }
    } catch (error) {
      console.error(
        "[fx] reconciliation could not process a receipt",
        { correlationId: input.correlationId, receiptId: receipt.id },
        error,
      );
      results.failed += 1;
    }
  }

  const last = receipts[receipts.length - 1];
  // A full batch may have more behind it, so hand back a cursor to resume;
  // a short batch reached the end, so the run is complete.
  const nextCursor =
    receipts.length === limit && last
      ? { purchasedAt: last.purchasedAt.toISOString(), id: last.id }
      : null;

  return { processed: receipts.length, nextCursor, results };
}
