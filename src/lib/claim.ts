import { prisma } from "@/lib/db";
import { classifyForOwner } from "@/lib/classify-receipt";
import { captureConversionQuietly } from "@/lib/fx/conversion-service";

function findWithRelations(id: string) {
  return prisma.receipt.findUnique({
    where: { id },
    include: { merchant: true, items: true },
  });
}

type ReceiptWithRelations = NonNullable<Awaited<ReturnType<typeof findWithRelations>>>;

export type ClaimPreviewResult =
  | { status: "not_found" }
  | { status: "expired" }
  | { status: "already_claimed" }
  | { status: "previewable"; receipt: ReceiptWithRelations };

/**
 * Read-only lookup — never mutates. This is what `GET /api/claim/[token]`
 * and the `/claim/[token]` page's initial render use, so a crawler, link
 * preview bot, or browser prefetch can hit it without consuming the
 * token. HTTP's own rules require GET to stay safe (RFC 9110) — the
 * actual claim+attach only ever happens through `resolveClaim` below,
 * which is wired to POST only.
 */
export async function previewClaim(token: string): Promise<ClaimPreviewResult> {
  const receipt = await prisma.receipt.findUnique({ where: { claimToken: token } });
  if (!receipt) return { status: "not_found" };
  if (receipt.claimTokenExpiresAt && receipt.claimTokenExpiresAt < new Date()) {
    return { status: "expired" };
  }
  if (receipt.claimedAt) return { status: "already_claimed" };

  const withRelations = await findWithRelations(receipt.id);
  if (!withRelations) return { status: "not_found" };
  return { status: "previewable", receipt: withRelations };
}

export type ClaimResult =
  | { status: "unauthenticated" }
  | { status: "not_found" }
  | { status: "expired" }
  | { status: "already_claimed" }
  | { status: "claimed"; receipt: ReceiptWithRelations };

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
 *
 * This function mutates and must only ever be reachable via POST — see
 * `previewClaim` above for the read-only lookup GET uses instead.
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
    // Lost the race to a concurrent claim, or the token expired in the
    // narrow window between the read above and this update — re-read to
    // report the real reason instead of always guessing "already_claimed"
    // (the two have different, user-visible meanings: 409 vs 410).
    const current = await prisma.receipt.findUnique({ where: { id: receipt.id } });
    if (current?.claimTokenExpiresAt && current.claimTokenExpiresAt < new Date()) {
      return { status: "expired" };
    }
    return { status: "already_claimed" };
  }

  /**
   * Session 6. A merchant-issued receipt has no owner when it is created,
   * so there are no rules to classify it with until this moment — the
   * claim is the first point at which "whose categories?" has an answer.
   *
   * Deliberately after the guarded update rather than inside it. That
   * update is the atomicity guarantee for the whole claim protocol (see
   * above), and classification is a convenience: if it fails, the receipt
   * is still correctly claimed and still correctly owned, just filed
   * under the category it arrived with. Folding it into the guard would
   * trade a real ownership guarantee for a cosmetic one.
   */
  await classifyClaimedReceipt(receipt.id, userId);

  // Session 7, and for the same reason as the classification above: a
  // merchant-issued receipt has no owner when it is created, so it has no
  // reporting currency to convert into until the claim gives it one.
  await captureConversionQuietly(receipt.id);

  const claimed = await findWithRelations(receipt.id);
  if (!claimed) return { status: "not_found" };
  return { status: "claimed", receipt: claimed };
}

async function classifyClaimedReceipt(receiptId: string, ownerId: string): Promise<void> {
  const receipt = await prisma.receipt.findUnique({
    where: { id: receiptId },
    include: { merchant: true, items: true },
  });
  if (!receipt) return;

  const classified = await classifyForOwner(ownerId, {
    merchantName: receipt.merchant.name,
    category: receipt.category,
    items: receipt.items,
  });

  const itemUpdates = receipt.items
    .map((item, index) => ({ item, category: classified.items[index] }))
    .filter(({ item, category }) => category !== item.category);

  if (classified.category === receipt.category && itemUpdates.length === 0) return;

  await prisma.$transaction([
    ...(classified.category === receipt.category
      ? []
      : [prisma.receipt.update({ where: { id: receiptId }, data: { category: classified.category } })]),
    ...itemUpdates.map(({ item, category }) =>
      prisma.receiptItem.update({ where: { id: item.id }, data: { category } }),
    ),
  ]);
}
