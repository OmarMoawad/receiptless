import { cookies } from "next/headers";
import Link from "next/link";
import { getCurrentUserFromCookies } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatMinorUnits } from "@/lib/money";

export const dynamic = "force-dynamic";

const VERIFICATION_LABEL: Record<string, string> = {
  UNVERIFIED: "Unverified",
  IMPORTED: "Imported",
  MERCHANT_VERIFIED: "Merchant verified",
};

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
  const receipts = await prisma.receipt.findMany({
    where: {
      ownerId: user.userId,
      ...(q
        ? {
            OR: [
              { merchant: { name: { contains: q } } },
              { notes: { contains: q } },
              { items: { some: { name: { contains: q } } } },
            ],
          }
        : {}),
    },
    include: { merchant: true, items: true },
    orderBy: { purchasedAt: "desc" },
    take: 100,
  });

  return (
    <main className="flex flex-col gap-4 p-6 max-w-2xl mx-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Your vault</h1>
        <Link
          href="/receipts/new"
          className="rounded bg-emerald-600 text-white px-4 py-2 text-sm"
        >
          + Add receipt
        </Link>
      </div>

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

      {receipts.length === 0 && (
        <p className="text-neutral-500 text-sm">
          {q ? `No receipts match "${q}".` : "No receipts yet. Add your first one."}
        </p>
      )}

      <ul className="flex flex-col gap-2">
        {receipts.map((r) => (
          <li
            key={r.id}
            className="flex items-center justify-between border rounded px-4 py-3"
          >
            <div>
              <p className="font-medium">{r.merchant.name}</p>
              <p className="text-sm text-neutral-500">
                {r.purchasedAt.toISOString().slice(0, 10)} · {r.category} ·{" "}
                {r.source} · {VERIFICATION_LABEL[r.verification]}
                {r.items.length > 0 && ` · ${r.items.length} item${r.items.length === 1 ? "" : "s"}`}
              </p>
            </div>
            <p className="font-mono">{formatMinorUnits(r.totalMinor, r.currency)}</p>
          </li>
        ))}
      </ul>
    </main>
  );
}
