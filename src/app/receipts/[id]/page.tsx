import { cookies } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CoverageEditor } from "@/components/CoverageEditor";
import { getCurrentUserFromCookies } from "@/lib/auth";
import {
  describeDaysLeft,
  formatCoverageDate,
  returnWindow,
  warrantyWindow,
} from "@/lib/coverage";
import { prisma } from "@/lib/db";
import { formatMinorUnits } from "@/lib/money";

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
