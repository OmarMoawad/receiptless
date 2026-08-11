import { cookies, headers } from "next/headers";
import Link from "next/link";
import { getCurrentUserFromCookies } from "@/lib/auth";
import { previewClaim } from "@/lib/claim";
import { formatMinorUnits } from "@/lib/money";
import { isSameOriginFromHeaders } from "@/lib/origin-check";
import ClaimButton from "./ClaimButton";

export const dynamic = "force-dynamic";

function InfoPage({ title, body }: { title: string; body: string }) {
  return (
    <main className="flex flex-col items-center gap-2 p-6 text-center">
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="text-neutral-500 text-sm">{body}</p>
    </main>
  );
}

/**
 * Read-only preview — this page (a GET) never claims anything itself; it
 * shows what the token resolves to and, if there's something claimable,
 * renders <ClaimButton>, whose form POSTs to the claimReceipt Server
 * Action (./actions.ts). See RECEIPTLESS_STATE.md's Session 3 follow-up:
 * claiming used to happen on this page's own GET, which meant a link
 * preview bot, crawler, or browser prefetch could silently consume a
 * token — HTTP requires GET to stay safe (RFC 9110), so the mutation
 * moved behind a POST-only action instead.
 */
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

  if (!user) {
    return (
      <InfoPage
        title="Sign in to claim this receipt"
        body="This receipt link is only valid for a signed-in account — sign in, then open the link again."
      />
    );
  }

  const preview = await previewClaim(token);

  if (preview.status === "not_found") {
    return (
      <InfoPage
        title="Claim link not found"
        body="This receipt link is invalid or was already removed."
      />
    );
  }

  if (preview.status === "expired") {
    return (
      <InfoPage
        title="Claim link expired"
        body="Ask the merchant to resend your receipt."
      />
    );
  }

  if (preview.status === "already_claimed") {
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

  const receipt = preview.receipt;

  return (
    <main className="flex flex-col items-center gap-4 p-6 max-w-sm mx-auto text-center">
      <h1 className="text-xl font-semibold">Claim this receipt?</h1>
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
      <ClaimButton token={token} />
    </main>
  );
}
