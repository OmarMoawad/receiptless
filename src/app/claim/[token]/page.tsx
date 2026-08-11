import { cookies, headers } from "next/headers";
import Link from "next/link";
import { getCurrentUserFromCookies } from "@/lib/auth";
import { resolveClaim } from "@/lib/claim";
import { formatMinorUnits } from "@/lib/money";
import { isSameOriginFromHeaders } from "@/lib/origin-check";

export const dynamic = "force-dynamic";

function InfoPage({ title, body }: { title: string; body: string }) {
  return (
    <main className="flex flex-col items-center gap-2 p-6 text-center">
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="text-neutral-500 text-sm">{body}</p>
    </main>
  );
}

export default async function ClaimPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const headersList = await headers();

  if (!isSameOriginFromHeaders(headersList)) {
    return (
      <InfoPage
        title="Link couldn't be verified"
        body="Open this receipt link directly from your merchant or messages, not from another site."
      />
    );
  }

  const cookieStore = await cookies();
  const user = await getCurrentUserFromCookies(cookieStore);
  const result = await resolveClaim(token, user?.userId ?? null);

  if (result.status === "unauthenticated") {
    return (
      <InfoPage
        title="Sign in to claim this receipt"
        body="This receipt link is only valid for a signed-in account — sign in, then open the link again."
      />
    );
  }

  if (result.status === "not_found") {
    return (
      <InfoPage
        title="Claim link not found"
        body="This receipt link is invalid or was already removed."
      />
    );
  }

  if (result.status === "expired") {
    return (
      <InfoPage
        title="Claim link expired"
        body="Ask the merchant to resend your receipt."
      />
    );
  }

  if (result.status === "already_claimed") {
    return (
      <main className="flex flex-col items-center gap-3 p-6 text-center">
        <h1 className="text-xl font-semibold">Already claimed</h1>
        <p className="text-neutral-500 text-sm max-w-xs">
          This claim link has already been used and can&apos;t be reused —
          that&apos;s intentional, so a token can&apos;t be replayed by
          anyone who saw the QR before you scanned it.
        </p>
        <Link href="/receipts" className="text-sm text-emerald-600 underline">
          View your vault →
        </Link>
      </main>
    );
  }

  const receipt = result.receipt;

  return (
    <main className="flex flex-col items-center gap-4 p-6 max-w-sm mx-auto text-center">
      <div className="rounded-full bg-emerald-100 text-emerald-700 w-12 h-12 flex items-center justify-center text-2xl">
        ✓
      </div>
      <h1 className="text-xl font-semibold">Receipt claimed</h1>
      <div className="border rounded p-4 w-full text-left">
        <p className="font-medium">{receipt.merchant.name}</p>
        <p className="text-sm text-neutral-500">
          {receipt.purchasedAt.toISOString().slice(0, 10)}
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
