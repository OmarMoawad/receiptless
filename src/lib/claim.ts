import { prisma } from "@/lib/db";

export type ClaimResult =
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
 * Resolves a claim token exactly once. A claim token is meant to behave
 * like a one-time-use credential: the first valid, unexpired request
 * claims the receipt; every request after that — even with the same
 * still-unexpired token — is rejected rather than silently re-serving the
 * receipt. That matters because nothing stops someone who saw the QR
 * before it was scanned from holding onto the token and replaying it.
 *
 * The claim itself is an atomic conditional update (`updateMany` guarded
 * on `claimedAt: null`) so two near-simultaneous requests for the same
 * token can't both "win" the claim.
 *
 * There's no per-user ownership yet (no auth — see ROADMAP.md Phase 1), so
 * "claimed" currently just means "consumed," not "owned by a specific
 * customer." Once accounts exist, this is where the token should attach
 * the receipt to a User instead of merely flipping a timestamp.
 */
export async function resolveClaim(token: string): Promise<ClaimResult> {
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
    where: { id: receipt.id, claimedAt: null },
    data: { claimedAt: new Date() },
  });

  if (count === 0) {
    // Lost the race to a concurrent claim of the same token.
    return { status: "already_claimed" };
  }

  const claimed = await findWithRelations(receipt.id);
  if (!claimed) return { status: "not_found" };
  return { status: "claimed", receipt: claimed };
}
