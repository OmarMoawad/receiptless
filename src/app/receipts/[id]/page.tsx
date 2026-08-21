import { cookies } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CoverageEditor } from "@/components/CoverageEditor";
import { ExchangeRateEditor } from "@/components/ExchangeRateEditor";
import { getCurrentUserFromCookies } from "@/lib/auth";
import {
  describeDaysLeft,
  formatCoverageDate,
  returnWindow,
  warrantyWindow,
} from "@/lib/coverage";
import { prisma } from "@/lib/db";
import { formatMinorUnits } from "@/lib/money";
import { captureConversion } from "@/lib/fx/conversion-service";

export const dynamic = "force-dynamic";

/**
 * The receipt this repo never had a page for. Until Phase 2 session 4 the
 * only view of a receipt was one row in the vault list, which is enough to
 * find it and not enough to do anything with it — including the thing
 * ROADMAP.md names as a use case, "I need to return this".
 */
export default async function ReceiptPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const cookieStore = await cookies();
  const user = await getCurrentUserFromCookies(cookieStore);
  if (!user) {
    return (
      <main className="flex flex-col items-center gap-2 p-6 text-center">
        <h1 className="text-xl font-semibold">Sign in to view this receipt</h1>
        <Link href="/signin" className="rounded bg-emerald-600 text-white px-4 py-2 text-sm">
          Sign in or create an account
        </Link>
      </main>
    );
  }

  // Scoped by ownerId in the same query that finds it, so another user's
  // receipt id is indistinguishable from one that does not exist.
  const receipt = await prisma.receipt.findFirst({
    where: { id, ownerId: user.userId },
    include: { merchant: true, items: { orderBy: { name: "asc" } } },
  });
  if (!receipt) notFound();

  const now = new Date();

  /**
   * Session 7. Idempotent, so viewing a receipt that arrived before a
   * rate existed picks the conversion up the moment one does — without
   * ever re-converting one that already has a stored snapshot. Reading
   * the page never changes a figure that is already recorded.
   */
  const conversion = await captureConversion(receipt.id);

  return (
    <main className="flex flex-col gap-5 p-6 max-w-2xl mx-auto">
      <div className="flex flex-col gap-1">
        <Link href="/receipts" className="text-sm text-neutral-500">
          ← Your vault
        </Link>
        <div className="flex items-baseline justify-between gap-4">
          <h1 className="text-xl font-semibold">{receipt.merchant.name}</h1>
          <p className="font-mono">{formatMinorUnits(receipt.totalMinor, receipt.currency)}</p>
        </div>
        <p className="text-sm text-neutral-500">
          {formatCoverageDate(receipt.purchasedAt)} · {receipt.category} · {receipt.source}
        </p>
        {receipt.notes && <p className="text-sm">{receipt.notes}</p>}
      </div>

      {/*
        Session 7. The converted figure sits next to the original rather
        than replacing it: the receipt is evidence of what was paid, in
        the currency it was paid in, and the conversion is a derived
        reading of it. Showing only the converted number would quietly
        restate the receipt.
      */}
      {conversion.status === "converted" && (
        <section className="flex flex-col gap-1 rounded border border-neutral-200 dark:border-neutral-800 p-3">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="text-sm font-semibold">In {conversion.snapshot.targetCurrency}</h2>
            <p className="font-mono">
              {formatMinorUnits(
                conversion.snapshot.totalTargetMinor,
                conversion.snapshot.targetCurrency,
              )}
            </p>
          </div>
          <p className="text-xs text-neutral-500">
            At {conversion.snapshot.rate} {conversion.snapshot.targetCurrency} per 1{" "}
            {conversion.snapshot.sourceCurrency}, the rate on file for{" "}
            {formatCoverageDate(conversion.snapshot.rateEffectiveDate)} (
            {conversion.snapshot.rateSource})
            {conversion.snapshot.version > 1 && ` · version ${conversion.snapshot.version}`}.
            Stored when this receipt was saved — never recalculated at today&rsquo;s rate.
          </p>
          <details className="text-xs text-neutral-500">
            <summary className="cursor-pointer">Correct this rate</summary>
            <div className="pt-2">
              <ExchangeRateEditor
                receiptId={receipt.id}
                sourceCurrency={conversion.snapshot.sourceCurrency}
                targetCurrency={conversion.snapshot.targetCurrency}
                purchasedOn={formatCoverageDate(receipt.purchasedAt)}
                currentRate={conversion.snapshot.rate}
              />
            </div>
          </details>
        </section>
      )}

      {/*
        Step 3's visible unavailable state. Say the number is not known
        rather than substituting today's rate for it.
      */}
      {conversion.status === "unavailable" && conversion.targetCurrency && (
        <section className="flex flex-col gap-2 rounded border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 p-3">
          <h2 className="text-sm font-semibold text-amber-800 dark:text-amber-400">
            Value in {conversion.targetCurrency} is not known
          </h2>
          <p className="text-xs text-amber-800 dark:text-amber-400">{conversion.reason}</p>
          <ExchangeRateEditor
            receiptId={receipt.id}
            sourceCurrency={conversion.sourceCurrency}
            targetCurrency={conversion.targetCurrency}
            purchasedOn={formatCoverageDate(receipt.purchasedAt)}
          />
        </section>
      )}

      {receipt.items.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold">Items</h2>
          <ul className="flex flex-col gap-1">
            {receipt.items.map((item) => {
              const warranty = warrantyWindow(receipt.purchasedAt, item.warrantyMonths, now);
              const returns = returnWindow(receipt.purchasedAt, item.returnWindowDays, now);
              return (
                <li key={item.id} className="flex items-baseline justify-between gap-4 text-sm">
                  <span>
                    {item.name}
                    {/*
                      Stated on the item itself as well as on /coverage,
                      because this is where someone lands when they have
                      the receipt in front of them and one question.
                    */}
                    {returns && (
                      <span
                        className={
                          returns.status === "expired"
                            ? " text-neutral-500"
                            : " text-emerald-700 dark:text-emerald-500"
                        }
                      >
                        {" "}
                        · returnable until {formatCoverageDate(returns.endsAt)} (
                        {describeDaysLeft(returns)})
                      </span>
                    )}
                    {warranty && (
                      <span
                        className={
                          warranty.status === "expired"
                            ? " text-neutral-500"
                            : " text-emerald-700 dark:text-emerald-500"
                        }
                      >
                        {" "}
                        · warranty to {formatCoverageDate(warranty.endsAt)} (
                        {describeDaysLeft(warranty)})
                      </span>
                    )}
                  </span>
                  <span className="font-mono text-neutral-500">
                    {formatMinorUnits(item.totalPriceMinor, receipt.currency)}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <CoverageEditor
        receiptId={receipt.id}
        items={receipt.items.map((item) => ({
          id: item.id,
          name: item.name,
          warrantyMonths: item.warrantyMonths,
          returnWindowDays: item.returnWindowDays,
        }))}
      />
    </main>
  );
}
