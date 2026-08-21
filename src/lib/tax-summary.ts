import { prisma } from "./db";
import { CATEGORIES, type CategoryName } from "./categories";

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

export type TaxSummary = {
  year: number;
  currency: string | null;
  lines: TaxCategoryLine[];
  totalMinor: number;
  receiptCount: number;
  /**
   * Set when the year's receipts are not all in one currency. Session 7
   * adds historical FX; until then, summing across currencies would
   * produce a confident wrong number, so the total is reported per the
   * dominant currency and this names the problem instead.
   */
  mixedCurrencies: string[];
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

  const receipts = await prisma.receipt.findMany({
    where: { ownerId, purchasedAt: { gte: start, lt: end } },
    include: { items: true },
    orderBy: { purchasedAt: "asc" },
  });

  const blank = (): Omit<TaxCategoryLine, "category"> => ({
    totalMinor: 0,
    receiptCount: 0,
    itemTotalMinor: 0,
    itemCount: 0,
  });

  const byCategory = new Map<CategoryName, Omit<TaxCategoryLine, "category">>(
    CATEGORIES.map((category) => [category, blank()]),
  );

  const currencyTotals = new Map<string, number>();

  for (const receipt of receipts) {
    const line = byCategory.get(receipt.category as CategoryName) ?? blank();
    line.totalMinor += receipt.totalMinor;
    line.receiptCount += 1;
    byCategory.set(receipt.category as CategoryName, line);

    currencyTotals.set(receipt.currency, (currencyTotals.get(receipt.currency) ?? 0) + receipt.totalMinor);

    for (const item of receipt.items) {
      const itemLine = byCategory.get(item.category as CategoryName) ?? blank();
      itemLine.itemTotalMinor += item.totalPriceMinor;
      itemLine.itemCount += 1;
      byCategory.set(item.category as CategoryName, itemLine);
    }
  }

  const currencies = [...currencyTotals.entries()].sort((a, b) => b[1] - a[1]);
  const dominant = currencies[0]?.[0] ?? null;

  const lines = CATEGORIES.map((category) => ({
    category,
    ...(byCategory.get(category) ?? blank()),
  })).filter((line) => line.receiptCount > 0 || line.itemCount > 0);

  return {
    year,
    currency: dominant,
    lines,
    totalMinor: receipts.reduce((sum, receipt) => sum + receipt.totalMinor, 0),
    receiptCount: receipts.length,
    mixedCurrencies: currencies.length > 1 ? currencies.map(([code]) => code) : [],
  };
}
