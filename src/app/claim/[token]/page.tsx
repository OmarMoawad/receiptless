import Link from "next/link";
import { prisma } from "@/lib/db";
import { formatMinorUnits } from "@/lib/money";

export const dynamic = "force-dynamic";

export default async function ClaimPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const receipt = await prisma.receipt.findUnique({
    where: { claimToken: token },
    include: { merchant: true, items: true },
  });

  if (!receipt) {
    return (
      <main className="flex flex-col items-center gap-2 p-6 text-center">
        <h1 className="text-xl font-semibold">Claim link not found</h1>
        <p className="text-neutral-500 text-sm">
          This receipt link is invalid or was already removed.
        </p>
      </main>
    );
  }

  if (receipt.claimTokenExpiresAt && receipt.claimTokenExpiresAt < new Date()) {
    return (
      <main className="flex flex-col items-center gap-2 p-6 text-center">
        <h1 className="text-xl font-semibold">Claim link expired</h1>
        <p className="text-neutral-500 text-sm">
          Ask the merchant to resend your receipt.
        </p>
      </main>
    );
  }

  if (!receipt.claimedAt) {
    await prisma.receipt.update({
      where: { id: receipt.id },
      data: { claimedAt: new Date() },
    });
  }

  return (
    <main className="flex flex-col items-center gap-4 p-6 max-w-sm mx-auto text-center">
      <div className="rounded-full bg-emerald-100 text-emerald-700 w-12 h-12 flex items-center justify-center text-2xl">
        ✓
      </div>
      <h1 className="text-xl font-semibold">Receipt claimed</h1>
      <div className="border rounded p-4 w-full text-left">
        <p className="font-medium">{receipt.merchant.name}</p>
        <p className="text-sm text-neutral-500">
          {receipt.purchasedAt.toISOString().slice(0, 10)} · Merchant verified
        </p>
        <p className="font-mono text-lg mt-2">
          {formatMinorUnits(receipt.totalMinor, receipt.currency)}
        </p>
        {receipt.items.length > 0 && (
          <ul className="mt-3 text-sm text-neutral-600 flex flex-col gap-1">
            {receipt.items.map((item) => (
              <li key={item.id} className="flex justify-between">
                <span>
                  {item.quantity}× {item.name}
                </span>
                <span>{formatMinorUnits(item.totalPriceMinor, receipt.currency)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <Link href="/receipts" className="text-sm text-emerald-600 underline">
        View in your vault →
      </Link>
    </main>
  );
}
