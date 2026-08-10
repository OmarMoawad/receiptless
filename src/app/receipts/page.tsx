import Link from "next/link";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function ReceiptsPage() {
  const receipts = await prisma.receipt.findMany({
    orderBy: { purchasedAt: "desc" },
    take: 100,
  });

  return (
    <main className="flex flex-col gap-4 p-6 max-w-2xl mx-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Receipts</h1>
        <Link
          href="/receipts/new"
          className="rounded bg-emerald-600 text-white px-4 py-2 text-sm"
        >
          + Add receipt
        </Link>
      </div>

      {receipts.length === 0 && (
        <p className="text-neutral-500 text-sm">
          No receipts yet. Add your first one.
        </p>
      )}

      <ul className="flex flex-col gap-2">
        {receipts.map((r) => (
          <li
            key={r.id}
            className="flex items-center justify-between border rounded px-4 py-3"
          >
            <div>
              <p className="font-medium">{r.merchant}</p>
              <p className="text-sm text-neutral-500">
                {r.purchasedAt.toISOString().slice(0, 10)} · {r.category} ·{" "}
                {r.source}
              </p>
            </div>
            <p className="font-mono">
              {r.currency} {r.amount.toFixed(2)}
            </p>
          </li>
        ))}
      </ul>
    </main>
  );
}
