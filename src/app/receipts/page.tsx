import { cookies } from "next/headers";
import { Suspense } from "react";
import Link from "next/link";
import { GmailConnections } from "@/components/GmailConnections";
import { getCurrentUserFromCookies } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { describeMatch, searchReceipts } from "@/lib/search";
import { formatMinorUnits } from "@/lib/money";
import {
  type CoverageWindow,
  describeDaysLeft,
  formatCoverageDate,
  returnWindow,
} from "@/lib/coverage";

export const dynamic = "force-dynamic";

const VERIFICATION_LABEL: Record<string, string> = {
  UNVERIFIED: "Unverified",
  IMPORTED: "Imported",
  MERCHANT_VERIFIED: "Merchant verified",
};

/**
 * The soonest still-open return window across a receipt's items, or null.
 * Shown on the list because a return deadline is the one thing about a
 * receipt that stops being actionable if you see it a week late — Phase 2
 * session 4 (RECEIPTLESS_STATE.md). Warranties are deliberately not shown
 * here: they run for years, so they belong on /coverage rather than on
 * every row of the vault.
 */
function soonestOpenReturn(
  purchasedAt: Date,
  items: Array<{ returnWindowDays: number | null }>,
  now: Date,
): CoverageWindow | null {
  const open = items
    .map((item) => returnWindow(purchasedAt, item.returnWindowDays, now))
    .filter((window): window is CoverageWindow => window !== null && window.status !== "expired");
  return open.length > 0
    ? open.reduce((soonest, window) => (window.daysLeft < soonest.daysLeft ? window : soonest))
    : null;
}

export default async function ReceiptsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;

  const cookieStore = await cookies();
  const user = await getCurrentUserFromCookies(cookieStore);
  if (!user) {
    return (
      <main className="flex flex-col items-center gap-2 p-6 text-center">
        <h1 className="text-xl font-semibold">Sign in to view your vault</h1>
        <p className="text-neutral-500 text-sm">
          Your receipts are only visible while signed in.
        </p>
        <Link href="/signin" className="rounded bg-emerald-600 text-white px-4 py-2 text-sm">
          Sign in or create an account
        </Link>
      </main>
    );
  }

  // Found via a real click-through: this page used to query every user's
  // receipts with no ownerId filter at all, bypassing Session 3's
  // tenant-isolation work entirely since it never goes through
  // /api/receipts. Fixed the same way every API route already is.
  // Fetched here rather than from the client on mount: this component
  // already has database access, and the mount effect it replaces set
  // state from inside an effect body, which React flags as a cascading
  // render. Selected field by field — encryptedTokenData must never reach
  // the browser, and an explicit select means a sensitive column added
  // later cannot start leaking silently.
  const emailConnections = await prisma.emailConnection.findMany({
    where: { userId: user.userId },
    select: {
      id: true,
      provider: true,
      status: true,
      providerAccountEmail: true,
      lastScannedAt: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  });
  const connections = emailConnections.map((connection) => ({
    ...connection,
    lastScannedAt: connection.lastScannedAt?.toISOString() ?? null,
    createdAt: connection.createdAt.toISOString(),
  }));

  /**
   * Searching and listing are different queries, and this page used to
   * blur them into one `findMany` with an optional OR block — which is how
   * it ended up with its own copy of the search logic, duplicating
   * /api/search. Session 3's tenant-isolation bug on this page came from
   * exactly that kind of divergence, so there is now one implementation
   * (lib/search.ts) and this page calls it.
   */
  const hits = q ? await searchReceipts(user.userId, q, 100) : [];
  const receipts = q
    ? hits.map((hit) => hit.receipt)
    : await prisma.receipt.findMany({
        where: { ownerId: user.userId },
        include: { merchant: true, items: true },
        orderBy: { purchasedAt: "desc" },
        take: 100,
      });
  // Why each receipt matched, keyed by id — shown under the result so a
  // search that returns something unexpected explains itself instead of
  // looking broken.
  const now = new Date();
  const matchReasons = new Map(hits.map((hit) => [hit.receipt.id, describeMatch(hit.matchedOn)]));
  const usedFallback = hits.length > 0 && hits.every((hit) => hit.matchedOn.viaFallback);

  return (
    <main className="flex flex-col gap-4 p-6 max-w-2xl mx-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Your vault</h1>
        <div className="flex flex-wrap items-center justify-end gap-3">
          <a
            href="/api/export/csv"
            className="text-sm text-neutral-500"
            download
          >
            Export CSV
          </a>
          <a
            href="/api/export/pdf"
            className="text-sm text-neutral-500"
            download
          >
            Export PDF
          </a>
          <Link href="/coverage" className="text-sm text-neutral-500">
            Warranties and returns
          </Link>
          <Link href="/tax" className="text-sm text-neutral-500">
            Tax summary
          </Link>
          <Link href="/settings" className="text-sm text-neutral-500">
            Settings
          </Link>
          <Link
            href="/receipts/new"
            className="rounded bg-emerald-600 text-white px-4 py-2 text-sm"
          >
            + Add receipt
          </Link>
        </div>
      </div>

      {/*
        Session 10 slice: this is where Gmail connection lives. Session 9
        built the entire OAuth backend and shipped no interface for it —
        there was no way to connect an account, scan, or disconnect, and
        the callback's own ?gmail= result was never displayed.

        Suspense because GmailConnections reads searchParams via
        useSearchParams, which Next.js requires be suspended in a server
        component tree.
      */}
      <Suspense fallback={null}>
        <GmailConnections initialConnections={connections} />
      </Suspense>

      <form className="flex gap-2">
        <input
          type="search"
          name="q"
          defaultValue={q ?? ""}
          placeholder="Search merchants, items, notes…"
          className="border rounded px-3 py-2 flex-1 bg-transparent text-sm"
        />
        <button
          type="submit"
          className="rounded border px-4 py-2 text-sm"
        >
          Search
        </button>
      </form>

      {/*
        Said plainly rather than silently: these results come from a
        substring scan because full text found nothing, so they are not
        ranked by relevance and the order is by date.
      */}
      {usedFallback && (
        <p className="text-xs text-neutral-500">
          No exact word matches for &ldquo;{q}&rdquo; — showing receipts that merely contain it, newest first.
        </p>
      )}

      {receipts.length === 0 && (
        <p className="text-neutral-500 text-sm">
          {q ? `No receipts match "${q}".` : "No receipts yet. Add your first one."}
        </p>
      )}

      <ul className="flex flex-col gap-2">
        {receipts.map((r) => (
          <li key={r.id} className="border rounded">
            {/*
              The vault list used to be a dead end — a row you could read
              and not open. Phase 2 session 4 gives every receipt a page,
              which is where warranty and return entry lives.
            */}
            <Link
              href={`/receipts/${r.id}`}
              className="flex items-center justify-between px-4 py-3"
            >
            <div>
              <p className="font-medium">{r.merchant.name}</p>
              <p className="text-sm text-neutral-500">
                {r.purchasedAt.toISOString().slice(0, 10)} · {r.category} ·{" "}
                {r.source} · {VERIFICATION_LABEL[r.verification]}
                {r.items.length > 0 && ` · ${r.items.length} item${r.items.length === 1 ? "" : "s"}`}
              </p>
              {/*
                ROADMAP.md asks for a search UI that shows *why* a receipt
                matched. Without it, a result whose merchant and total look
                unrelated to the query reads as a broken search rather than
                a note or an item line doing its job.
              */}
              {matchReasons.get(r.id) && (
                <p className="text-xs text-emerald-700 dark:text-emerald-500">{matchReasons.get(r.id)}</p>
              )}
            {(() => {
              const open = soonestOpenReturn(r.purchasedAt, r.items, now);
              return open ? (
                <p
                  className={
                    open.status === "ending-soon"
                      ? "text-xs text-amber-700 dark:text-amber-500"
                      : "text-xs text-emerald-700 dark:text-emerald-500"
                  }
                >
                  Returnable until {formatCoverageDate(open.endsAt)} — {describeDaysLeft(open)}
                </p>
              ) : null;
            })()}
            </div>
            <p className="font-mono">{formatMinorUnits(r.totalMinor, r.currency)}</p>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
