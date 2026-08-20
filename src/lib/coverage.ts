import { prisma } from "@/lib/db";

/**
 * Phase 2 session 4 (RECEIPTLESS_STATE.md): warranty and return windows,
 * surfaced. `ReceiptItem.warrantyMonths` and `ReceiptItem.returnWindowDays`
 * have been on the schema since Phase 0 and nothing has ever read them —
 * the seed comment on those columns said the data would exist "once that
 * phase is built". This is that phase.
 *
 * All of the date arithmetic here is UTC and day-granular on purpose.
 * `purchasedAt` is a timestamp, but a warranty is not measured in
 * milliseconds: "two years from the 31st of January" is a calendar
 * statement, and the answer a person expects to "can I still return this?"
 * does not change because it is now the afternoon.
 */

const MS_PER_DAY = 86_400_000;

/**
 * How close to the end a window has to be before it is called out rather
 * than simply listed. Different per kind because the useful notice period
 * is different: a return window is days long and missing it by a day is
 * final, while a warranty runs for years and a month's warning is still
 * enough time to act.
 */
export const RETURN_ENDING_SOON_DAYS = 3;
export const WARRANTY_ENDING_SOON_DAYS = 30;

export type CoverageStatus = "active" | "ending-soon" | "expired";

export type CoverageWindow = {
  /** The last day the cover applies, inclusive. */
  endsAt: Date;
  /** Whole days from today until `endsAt`. `0` means it ends today. */
  daysLeft: number;
  status: CoverageStatus;
};

/** Midnight UTC on the day `date` falls in. */
function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/**
 * Calendar month arithmetic, clamped to the end of the target month, so a
 * 1-month warranty bought on 31 January ends on 28 February rather than
 * rolling into March. `Date.UTC` normalises the month overflow for us;
 * only the day-of-month needs clamping.
 */
export function addMonthsUtc(start: Date, months: number): Date {
  const day = start.getUTCDate();
  const firstOfTarget = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + months, 1));
  const daysInTarget = new Date(
    Date.UTC(firstOfTarget.getUTCFullYear(), firstOfTarget.getUTCMonth() + 1, 0),
  ).getUTCDate();
  firstOfTarget.setUTCDate(Math.min(day, daysInTarget));
  return firstOfTarget;
}

export function addDaysUtc(start: Date, days: number): Date {
  return new Date(startOfUtcDay(start).getTime() + days * MS_PER_DAY);
}

function windowFrom(endsAt: Date, now: Date, endingSoonDays: number): CoverageWindow {
  const daysLeft = Math.round((endsAt.getTime() - startOfUtcDay(now).getTime()) / MS_PER_DAY);
  const status: CoverageStatus =
    daysLeft < 0 ? "expired" : daysLeft <= endingSoonDays ? "ending-soon" : "active";
  return { endsAt, daysLeft, status };
}

/**
 * `null` when the item carries no warranty metadata — which is not the
 * same as a warranty that has run out, and the UI must not conflate them.
 * "We were never told" and "it expired" are different answers to "is this
 * still under warranty?".
 */
export function warrantyWindow(
  purchasedAt: Date,
  warrantyMonths: number | null,
  now: Date,
): CoverageWindow | null {
  if (warrantyMonths === null || warrantyMonths <= 0) return null;
  return windowFrom(
    addMonthsUtc(startOfUtcDay(purchasedAt), warrantyMonths),
    now,
    WARRANTY_ENDING_SOON_DAYS,
  );
}

export function returnWindow(
  purchasedAt: Date,
  returnWindowDays: number | null,
  now: Date,
): CoverageWindow | null {
  if (returnWindowDays === null || returnWindowDays <= 0) return null;
  return windowFrom(addDaysUtc(purchasedAt, returnWindowDays), now, RETURN_ENDING_SOON_DAYS);
}

export type CoverageEntry = {
  itemId: string;
  itemName: string;
  receiptId: string;
  merchantName: string;
  purchasedAt: Date;
  currency: string;
  totalPriceMinor: number;
  warranty: CoverageWindow | null;
  returnWindow: CoverageWindow | null;
};

/**
 * Every item in this user's vault that carries either kind of cover.
 *
 * Owner-scoped through the receipt relation rather than by filtering
 * afterwards: `ReceiptItem` has no `ownerId` of its own, so the only
 * tenant boundary available is `receipt.ownerId`, and it belongs in the
 * `where` clause where it cannot be forgotten by a later caller. Session
 * 3's isolation bug and Session 4's follow-up were both a page querying
 * without it (RECEIPTLESS_STATE.md).
 */
export async function listCoverage(
  ownerId: string,
  now: Date = new Date(),
  options: { includeExpired?: boolean } = {},
): Promise<CoverageEntry[]> {
  const items = await prisma.receiptItem.findMany({
    where: {
      receipt: { ownerId },
      OR: [{ warrantyMonths: { not: null } }, { returnWindowDays: { not: null } }],
    },
    include: { receipt: { include: { merchant: true } } },
  });

  const entries = items.map((item) => ({
    itemId: item.id,
    itemName: item.name,
    receiptId: item.receiptId,
    merchantName: item.receipt.merchant.name,
    purchasedAt: item.receipt.purchasedAt,
    currency: item.receipt.currency,
    totalPriceMinor: item.totalPriceMinor,
    warranty: warrantyWindow(item.receipt.purchasedAt, item.warrantyMonths, now),
    returnWindow: returnWindow(item.receipt.purchasedAt, item.returnWindowDays, now),
  }));

  /**
   * "Expired" means *everything* on the item has run out, not that one of
   * the two windows has. An item whose 14-day return window closed months
   * ago but whose two-year warranty is still running is exactly what this
   * page exists to show, so it must survive this filter — which is why the
   * test is `soonestEnd`, the one function that already knows what is
   * still live, rather than a status comparison per window.
   */
  const live = options.includeExpired
    ? entries
    : entries.filter((entry) => soonestEnd(entry) !== Number.POSITIVE_INFINITY);

  return live.sort((a, b) => soonestEnd(a) - soonestEnd(b));
}

/**
 * Sorting key: whatever runs out first, because that is the thing a person
 * has the least time to act on. `Infinity` for an entry with nothing left
 * running keeps expired rows at the bottom when they are shown at all.
 */
export function soonestEnd(entry: CoverageEntry): number {
  const ends = [entry.warranty, entry.returnWindow]
    .filter((window): window is CoverageWindow => window !== null && window.status !== "expired")
    .map((window) => window.endsAt.getTime());
  return ends.length > 0 ? Math.min(...ends) : Number.POSITIVE_INFINITY;
}

/** `2026-08-20`, the same ISO day format the rest of the UI prints. */
export function formatCoverageDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Plain-language remaining time. Says "today" and "tomorrow" rather than
 * "0 days left", which reads as a bug even when it is arithmetically true.
 */
export function describeDaysLeft(window: CoverageWindow): string {
  if (window.daysLeft < 0) {
    const ago = Math.abs(window.daysLeft);
    return ago === 1 ? "ended yesterday" : `ended ${ago} days ago`;
  }
  if (window.daysLeft === 0) return "ends today";
  if (window.daysLeft === 1) return "ends tomorrow";
  return `${window.daysLeft} days left`;
}
