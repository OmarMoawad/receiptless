import { cookies } from "next/headers";
import Link from "next/link";
import { getCurrentUserFromCookies } from "@/lib/auth";
import {
  type CoverageEntry,
  type CoverageWindow,
  describeDaysLeft,
  formatCoverageDate,
  listCoverage,
} from "@/lib/coverage";
import { formatMinorUnits } from "@/lib/money";

export const dynamic = "force-dynamic";

/**
 * Phase 2 session 4 (RECEIPTLESS_STATE.md): the "still under warranty" and
 * "returnable until" view.
 *
 * Two lists rather than one, because they answer different questions on
 * different clocks. A return window is a deadline measured in days and
 * missing it is final; a warranty is a claim you make when something
 * breaks, months or years later. Merging them into a single "coverage"
 * list would bury the urgent one in the long one.
 */
function windowLine(label: string, window: CoverageWindow) {
  return (
    <p
      className={
        window.status === "ending-soon"
          ? "text-xs text-amber-700 dark:text-amber-500"
          : window.status === "expired"
            ? "text-xs text-neutral-500"
            : "text-xs text-emerald-700 dark:text-emerald-500"
      }
    >
      {label} {formatCoverageDate(window.endsAt)} — {describeDaysLeft(window)}
    </p>
  );
}

function EntryRow({ entry, kind }: { entry: CoverageEntry; kind: "return" | "warranty" }) {
  const window = kind === "return" ? entry.returnWindow : entry.warranty;
  if (!window) return null;
  return (
    <li className="border rounded px-4 py-3">
      <Link href={`/receipts/${entry.receiptId}`} className="flex items-baseline justify-between gap-4">
        <span>
          <span className="font-medium">{entry.itemName}</span>
          <span className="block text-sm text-neutral-500">
            {entry.merchantName} · bought {formatCoverageDate(entry.purchasedAt)}
          </span>
          {windowLine(kind === "return" ? "Returnable until" : "Under warranty until", window)}
        </span>
        <span className="font-mono text-sm text-neutral-500">
          {formatMinorUnits(entry.totalPriceMinor, entry.currency)}
        </span>
      </Link>
    </li>
  );
}

export default async function CoveragePage({
  searchParams,
}: {
  searchParams: Promise<{ expired?: string }>;
}) {
  const { expired } = await searchParams;
  const includeExpired = expired === "1";

  const cookieStore = await cookies();
  const user = await getCurrentUserFromCookies(cookieStore);
  if (!user) {
    return (
      <main className="flex flex-col items-center gap-2 p-6 text-center">
        <h1 className="text-xl font-semibold">Sign in to see your warranties</h1>
        <Link href="/signin" className="rounded bg-emerald-600 text-white px-4 py-2 text-sm">
          Sign in or create an account
        </Link>
      </main>
    );
  }

  const entries = await listCoverage(user.userId, new Date(), { includeExpired });

  const returnable = entries.filter(
    (entry) => entry.returnWindow && (includeExpired || entry.returnWindow.status !== "expired"),
  );
  const underWarranty = entries.filter(
    (entry) => entry.warranty && (includeExpired || entry.warranty.status !== "expired"),
  );

  return (
    <main className="flex flex-col gap-6 p-6 max-w-2xl mx-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Warranties and returns</h1>
        <Link href="/receipts" className="text-sm text-neutral-500">
          Your vault →
        </Link>
      </div>

      {entries.length === 0 && (
        <p className="text-sm text-neutral-500">
          Nothing here yet. Open a receipt and record how long an item is
          returnable or under warranty, and it will appear on this page.
        </p>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">Returnable</h2>
        {returnable.length === 0 ? (
          <p className="text-sm text-neutral-500">No open return windows.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {returnable.map((entry) => (
              <EntryRow key={`return-${entry.itemId}`} entry={entry} kind="return" />
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">Still under warranty</h2>
        {underWarranty.length === 0 ? (
          <p className="text-sm text-neutral-500">Nothing under warranty.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {underWarranty.map((entry) => (
              <EntryRow key={`warranty-${entry.itemId}`} entry={entry} kind="warranty" />
            ))}
          </ul>
        )}
      </section>

      {/*
        Expired cover is hidden by default and reachable rather than
        deleted: proving that something *was* under warranty on a given
        date is a real reason to keep a receipt, and this page is the only
        place that answers it.
      */}
      <Link
        href={includeExpired ? "/coverage" : "/coverage?expired=1"}
        className="text-xs text-neutral-500 underline"
      >
        {includeExpired ? "Hide expired cover" : "Show expired cover"}
      </Link>
    </main>
  );
}
