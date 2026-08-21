import { cookies } from "next/headers";
import Link from "next/link";
import { getCurrentUserFromCookies } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatMinorUnits } from "@/lib/money";
import { taxSummary } from "@/lib/tax-summary";
import { CategoryRules } from "./category-rules-client";

export const dynamic = "force-dynamic";

/**
 * Phase 2 session 6: what was spent, per category, over a tax year.
 *
 * Two columns per category rather than one, because they answer different
 * questions and conflating them would be wrong in a way nobody would
 * catch. A *receipt* total is what a return asks for and is filed under
 * exactly one category. An *item* total cuts across receipts — the
 * paracetamol bought during a grocery shop is a health item on a
 * groceries receipt. They will not add up to each other, and they are not
 * supposed to.
 */
export default async function TaxPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  const user = await getCurrentUserFromCookies(await cookies());
  if (!user) {
    return (
      <main className="mx-auto max-w-3xl p-6">
        <p className="text-sm">
          <Link href="/signin" className="underline">
            Sign in
          </Link>{" "}
          to see your tax summary.
        </p>
      </main>
    );
  }

  const currentYear = new Date().getUTCFullYear();
  const requested = Number((await searchParams).year);
  const year = Number.isInteger(requested) && requested >= 1970 && requested <= 9999 ? requested : currentYear;

  const [summary, rules] = await Promise.all([
    taxSummary(user.userId, year),
    prisma.categoryRule.findMany({
      where: { ownerId: user.userId },
      orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
    }),
  ]);

  const years = [currentYear, currentYear - 1, currentYear - 2];

  return (
    <main className="mx-auto max-w-3xl p-6 space-y-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-medium">Tax summary</h1>
        <nav className="flex gap-3 text-sm">
          {years.map((option) => (
            <Link
              key={option}
              href={`/tax?year=${option}`}
              className={option === year ? "font-medium underline" : "text-neutral-500 underline"}
            >
              {option}
            </Link>
          ))}
        </nav>
      </header>

      {/*
        Stated on the page, not buried in a doc. Deductibility depends on
        jurisdiction, employment status and the purpose of each purchase —
        facts this app does not have. Implying otherwise would be giving
        tax advice by accident, and being wrong costs real money.
      */}
      <p className="rounded border border-neutral-200 dark:border-neutral-800 p-3 text-xs text-neutral-600 dark:text-neutral-400">
        This organises what you spent. It does not decide what is deductible — that
        depends on where you are, how you earn, and what each purchase was for.
        Take it to whoever files your return.
      </p>

      {/*
        Session 7. This used to say mixed currencies were not converted at
        all. They are now — at the rate stored on each receipt when it was
        ingested, never at today's rate. What remains is the honest
        remainder: receipts with no rate on file are named here rather
        than folded into the total, because a total that quietly excludes
        them is worse than one that says what it is missing.
      */}
      {summary.unconverted.length > 0 && (
        <div className="rounded border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 p-3 text-xs text-amber-800 dark:text-amber-400 space-y-2">
          <p>
            <strong>Not included in the totals below.</strong> These receipts have
            no exchange rate on file for the day they were bought, so their value
            in {summary.currency} is not known. Converting them at today&apos;s
            rate would be a confident wrong number in your return.
          </p>
          <ul className="space-y-1">
            {summary.unconverted.map((line) => (
              <li key={line.currency}>
                {line.receiptCount} receipt{line.receiptCount === 1 ? "" : "s"}{" "}
                totalling {formatMinorUnits(line.totalMinor, line.currency)}
              </li>
            ))}
          </ul>
          <p>
            Open a receipt to enter the rate your bank charged. It is stored
            against that receipt permanently, so the figure never moves again.
          </p>
        </div>
      )}

      {summary.lines.length === 0 ? (
        <p className="text-sm text-neutral-500">No receipts in {year}.</p>
      ) : (
        <section className="space-y-3">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-200 dark:border-neutral-800 text-left">
                  <th className="py-2 font-medium">Category</th>
                  <th className="py-2 font-medium text-right">Receipts</th>
                  <th className="py-2 font-medium text-right">Receipt total</th>
                  <th className="py-2 font-medium text-right">Items</th>
                  <th className="py-2 font-medium text-right">Item total</th>
                </tr>
              </thead>
              <tbody>
                {summary.lines.map((line) => (
                  <tr key={line.category} className="border-b border-neutral-100 dark:border-neutral-900">
                    <td className="py-2">{line.category}</td>
                    <td className="py-2 text-right tabular-nums">{line.receiptCount || "—"}</td>
                    <td className="py-2 text-right tabular-nums">
                      {line.receiptCount ? formatMinorUnits(line.totalMinor, summary.currency ?? "USD") : "—"}
                    </td>
                    <td className="py-2 text-right tabular-nums">{line.itemCount || "—"}</td>
                    <td className="py-2 text-right tabular-nums">
                      {line.itemCount ? formatMinorUnits(line.itemTotalMinor, summary.currency ?? "USD") : "—"}
                    </td>
                  </tr>
                ))}
                <tr className="font-medium">
                  <td className="py-2">Total</td>
                  <td className="py-2 text-right tabular-nums">{summary.receiptCount}</td>
                  <td className="py-2 text-right tabular-nums">
                    {formatMinorUnits(summary.totalMinor, summary.currency ?? "USD")}
                  </td>
                  <td className="py-2 text-right text-neutral-400">—</td>
                  <td className="py-2 text-right text-neutral-400">—</td>
                </tr>
              </tbody>
            </table>
          </div>

          <a href={`/api/export/tax/csv?year=${year}`} className="inline-block text-sm underline">
            Download {year} summary (CSV)
          </a>
        </section>
      )}

      <CategoryRules
        initialRules={rules.map((rule) => ({
          id: rule.id,
          pattern: rule.pattern,
          category: rule.category,
          target: rule.target,
          priority: rule.priority,
        }))}
      />
    </main>
  );
}
