import type { MerchantRole, PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import {
  type MerchantCapability,
  MerchantForbiddenError,
  MerchantNotFoundError,
  roleHasCapability,
} from "./types";

/**
 * The single authorization gate for every merchant action. It answers two
 * questions at once and in the right order:
 *
 *   1. Is the caller a member of this account at all? If not, 404 — a
 *      non-member must not be able to tell an account they cannot touch
 *      apart from one that does not exist.
 *   2. Does the caller's role carry the capability this action needs? If
 *      not, 403.
 *
 * Returning the membership lets callers reuse the resolved role without a
 * second query. Accepts an optional transaction client so it can run inside
 * the same transaction as the mutation it guards.
 */
export async function requireMerchantCapability(
  userId: string,
  accountId: string,
  capability: MerchantCapability,
  client: Pick<PrismaClient, "merchantMembership"> = prisma,
): Promise<{ role: MerchantRole; membershipId: string }> {
  const membership = await client.merchantMembership.findUnique({
    where: { accountId_userId: { accountId, userId } },
    select: { id: true, role: true },
  });

  if (!membership) throw new MerchantNotFoundError();
  if (!roleHasCapability(membership.role, capability)) throw new MerchantForbiddenError();

  return { role: membership.role, membershipId: membership.id };
}
