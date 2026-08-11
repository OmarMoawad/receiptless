"use server";

import { cookies, headers } from "next/headers";
import { getCurrentUserFromCookies } from "@/lib/auth";
import { resolveClaim } from "@/lib/claim";
import { isSameOriginFromHeaders } from "@/lib/origin-check";

export type ClaimActionState =
  | { status: "idle" }
  | { status: "rejected" }
  | { status: "unauthenticated" }
  | { status: "not_found" }
  | { status: "expired" }
  | { status: "already_claimed" }
  | {
      status: "claimed";
      merchantName: string;
      currency: string;
      totalMinor: number;
      purchasedAt: string;
      items: { id: string; name: string; quantity: number; totalPriceMinor: number }[];
    };

/**
 * The only place a claim token is actually resolved and attached to an
 * account — a Server Action, which Next.js only ever invokes via POST and
 * whose Origin it validates against this deployment's own host before
 * this function body runs at all. The explicit isSameOriginFromHeaders
 * check below is defense-in-depth for the same reason
 * `/api/claim/[token]`'s POST route also checks it directly, not reliance
 * on Next's check alone.
 *
 * Bound to a token via `claimReceipt.bind(null, token)` before being
 * passed to `useActionState` in the client-side ClaimButton — that's what
 * makes the exported signature here `(token, prevState, formData)`.
 */
export async function claimReceipt(
  token: string,
  _prevState: ClaimActionState,
  _formData: FormData
): Promise<ClaimActionState> {
  const headersList = await headers();
  if (!isSameOriginFromHeaders(headersList)) {
    return { status: "rejected" };
  }

  const cookieStore = await cookies();
  const user = await getCurrentUserFromCookies(cookieStore);
  const result = await resolveClaim(token, user?.userId ?? null);

  if (result.status !== "claimed") return result;

  const { receipt } = result;
  return {
    status: "claimed",
    merchantName: receipt.merchant.name,
    currency: receipt.currency,
    totalMinor: receipt.totalMinor,
    purchasedAt: receipt.purchasedAt.toISOString(),
    items: receipt.items.map((item) => ({
      id: item.id,
      name: item.name,
      quantity: item.quantity,
      totalPriceMinor: item.totalPriceMinor,
    })),
  };
}
