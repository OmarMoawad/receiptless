import { prisma } from "@/lib/db";

export type ClaimResult =
  | { status: "unauthenticated" }
  | { status: "not_found" }
  | { status: "expired" }
  | { status: "already_claimed" }
  | { status: "claimed"; receipt: NonNullable<Awaited<ReturnType<typeof findWithRelations>>> };

function findWithRelations(id: string) {
  return prisma.receipt.findUnique({
    where: { id },
    include: { merchant: true, items: true },
  });
}

/**
 * Resolves a claim token exactly once and — since Session 3
 * (RECEIPTLESS_STATE.md) — attaches the resulting receipt to the
 * authenticated caller's account in the same atomic step: verify the
 * caller has a session, then in one conditional update, set both
 * `ownerId` and `claimedAt` together, guarded on the token still being
 * unclaimed and unexpired. There's no window between "check" and
 * "claim+attach" for a second request (or an expiry) to slip in.
 *
 * An unauthenticated caller is rejected *before* touching token state at
 * all, so an anonymous request can never burn a token the real owner
 * hasn't claimed yet. Once claimed, `ownerId` can never be reassigned —
 * the guarded update only ever matches a row where `claimedAt` is still
 * null.
 */
export async function resolveClaim(token: string, userId: string | null): Promise<ClaimResult> {
  if (!userId) return { status: "unauthenticated" };

  const receipt = await prisma.receipt.findUnique({
    where: { claimToken: token },
  });

  if (!receipt) return { status: "not_found" };

  if (receipt.claimTokenExpiresAt && receipt.claimTokenExpiresAt < new Date()) {
    return { status: "expired" };
  }

  if (receipt.claimedAt) {
    return { status: "already_claimed" };
  }

  const { count } = await prisma.receipt.updateMany({
    where: {
      id: receipt.id,
      claimedAt: null,
      OR: [{ claimTokenExpiresAt: null }, { claimTokenExpiresAt: { gt: new Date() } }],
    },
    data: { claimedAt: new Date(), ownerId: userId },
  });

  if (count === 0) {
    // Lost the race to a concurrent claim, or expired between the read above and here.
    return { status: "already_claimed" };
  }

  const claimed = await findWithRelations(receipt.id);
  if (!claimed) return { status: "not_found" };
  return { status: "claimed", receipt: claimed };
}
