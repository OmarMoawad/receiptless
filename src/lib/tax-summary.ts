import { prisma } from "./db";
import { CATEGORIES, type CategoryName } from "./categories";
import { convertAmount } from "./fx/convert";

/**
 * Session 6. The summary a person takes to their accountant, or uses to
 * fill a return: what was spent, per category, over a tax year.
 *
 * **It does not decide what is deductible, and it never will.**
 * Deductibility depends on jurisdiction, on employment status, on the
 * purpose of each purchase — facts this app does not have and should not
 * guess at. A vault that quietly labelled a category "deductible" would
 * be giving tax advice by implication, and being wrong about it costs the
 * user money in a way they would not discover until it mattered. So this
 * organises and totals; the person decides. Same discipline as the
 * verification ladder: report what is known, never imply more.
 *
 * **Session 7 replaced the mixed-currency placeholder.** This used to
 * refuse to add currencies together and report a dominant one instead.
 * It now converts, using the rate stored on each receipt at ingest —
 * never a rate fetched while the report is being read. A receipt with no
 * stored conversion is still not summed: it appears under `unconverted`
 * by name, because substituting today's rate would put a confident wrong
 * number in someone's return.
 */
export type TaxCategoryLine = {
  category: CategoryName;
  /** Receipt totals, which is what a return asks for. */
  totalMinor: number;
  receiptCount: number;
  /**
   * Item-level total for the same category, which will *not* equal
   * `totalMinor` and is not meant to. A receipt sits in one category
   * while its items may sit in several, so this answers a different
   * question: how much of my spending was on this kind of thing,
   * regardless of which shop it happened in.
   */
  itemTotalMinor: number;
  itemCount: number;
};

/**
 * A currency whose receipts could not be expressed in the reporting
 * currency, with its own untouched totals. Named, never summed — the
 * point is that the reader can see exactly what is missing from the
 * figure above rather than being handed a total that quietly excludes it.
 */
export type UnconvertedCurrencyLine = {
  currency: string;
  receiptCount: number;
  totalMinor: number;
};

export type TaxSummary = {
  year: number;
  /** The reporting currency every total below is expressed in. */
  currency: string;
  lines: TaxCategoryLine[];
  totalMinor: number;
  receiptCount: number;
  /** Receipts excluded from the totals above, grouped by their currency. */
  unconverted: UnconvertedCurrencyLine[];
};

export function taxYearRange(year: number): { start: Date; end: Date } {
  // Calendar year, UTC. A jurisdiction with an April-to-April year needs a
  // configurable boundary; that is a real feature and not a guess to make
  // silently, so it is deferred rather than approximated.
  return {
    start: new Date(Date.UTC(year, 0, 1, 0, 0, 0, 0)),
    end: new Date(Date.UTC(year + 1, 0, 1, 0, 0, 0, 0)),
  };
}

export async function taxSummary(ownerId: string, year: number): Promise<TaxSummary> {
  const { start, end } = taxYearRange(year);

  const [owner, receipts] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: ownerId }, select: { reportingCurrency: true } }),
    prisma.receipt.findMany({
      where: { ownerId, purchasedAt: { gte: start, lt: end } },
      include: { items: true, conversions: { where: { approved: true } } },
      orderBy: { purchasedAt: "asc" },
    }),
  ]);

  const reportingCurrency = owner.reportingCurrency.trim().toUpperCase();

  const blank = (): Omit<TaxCategoryLine, "category"> => ({
    totalMinor: 0,
    receiptCount: 0,
    itemTotalMinor: 0,
    itemCount: 0,
  });

  const byCategory = new Map<CategoryName, Omit<TaxCategoryLine, "category">>(
    CATEGORIES.map((category) => [category, blank()]),
  );

  const unconverted = new Map<string, UnconvertedCurrencyLine>();
  let totalMinor = 0;
  let receiptCount = 0;

  for (const receipt of receipts) {
    const receiptCurrency = receipt.currency.trim().toUpperCase();
    const snapshot = receipt.conversions[0];

    /**
     * Converts one amount from this receipt into the reporting currency.
     *
     * Items are converted with the receipt's *own stored* rate rather
     * than resolved again, so every line of a receipt is expressed at the
     * same rate as its total — and the whole summary is reproducible from
     * what is already on disk, with no provider call and no dependence on
     * the rate table still holding that row.
     */
    const toReporting = (minor: number): number | null => {
      if (receiptCurrency === reportingCurrency) return minor;
      if (!snapshot) return null;
      return convertAmount({
        sourceMinor: minor,
        sourceCurrency: snapshot.sourceCurrency,
        targetCurrency: snapshot.targetCurrency,
        rate: snapshot.rate,
      }).targetMinor;
    };

    const receiptTotal = toReporting(receipt.totalMinor);

    if (receiptTotal === null) {
      const line = unconverted.get(receiptCurrency) ?? {
        currency: receiptCurrency,
        receiptCount: 0,
        totalMinor: 0,
      };
      line.receiptCount += 1;
      line.totalMinor += receipt.totalMinor;
      unconverted.set(receiptCurrency, line);
      continue;
    }

    const line = byCategory.get(receipt.category as CategoryName) ?? blank();
    line.totalMinor += receiptTotal;
    line.receiptCount += 1;
    byCategory.set(receipt.category as CategoryName, line);

    totalMinor += receiptTotal;
    receiptCount += 1;

    for (const item of receipt.items) {
      const itemTotal = toReporting(item.totalPriceMinor);
      if (itemTotal === null) continue;
      const itemLine = byCategory.get(item.category as CategoryName) ?? blank();
      itemLine.itemTotalMinor += itemTotal;
      itemLine.itemCount += 1;
      byCategory.set(item.category as CategoryName, itemLine);
    }
  }

  const lines = CATEGORIES.map((category) => ({
    category,
    ...(byCategory.get(category) ?? blank()),
  })).filter((line) => line.receiptCount > 0 || line.itemCount > 0);

  return {
    year,
    currency: reportingCurrency,
    lines,
    totalMinor,
    receiptCount,
    unconverted: [...unconverted.values()].sort((a, b) => b.totalMinor - a.totalMinor),
  };
}
