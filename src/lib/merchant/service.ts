import { Prisma } from "@/generated/prisma/client";
import type { MerchantRole } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { requireMerchantCapability } from "./authorization";
import {
  type CreateMerchantAccountInput,
  type MerchantLocationInput,
  LastOwnerError,
  MerchantConflictError,
  MerchantNotFoundError,
} from "./types";

/**
 * Phase 3 Session 1 — merchant account lifecycle and membership/location
 * management. Every function is account- and membership-scoped; nothing here
 * touches a consumer's receipts, and a User's existing authentication is the
 * only identity involved.
 */

export type MerchantAccountSummary = {
  id: string;
  merchantId: string;
  merchantName: string;
  website: string | null;
  role: MerchantRole;
  createdAt: Date;
};

export type MerchantLocationSummary = {
  id: string;
  externalId: string;
  displayName: string;
  createdAt: Date;
  updatedAt: Date;
};

const P2002_UNIQUE_VIOLATION = "P2002";

/**
 * Create a brand-new merchant, its administrative account, the caller's
 * OWNER membership, and the first audit row — all in one transaction so a
 * half-created account can never exist. A pre-existing Merchant row (the
 * millions consumers have imported) is deliberately *never* attached: a
 * business claiming an established name is a later, verified-onboarding
 * concern, and letting the first POST win would let anyone seize "Starbucks".
 */
export async function createMerchantAccount(
  userId: string,
  input: CreateMerchantAccountInput,
): Promise<MerchantAccountSummary> {
  const name = input.name.trim();
  const website = input.website?.trim() || null;

  try {
    return await prisma.$transaction(async (tx) => {
      const merchant = await tx.merchant.create({ data: { name, website } });
      const account = await tx.merchantAccount.create({ data: { merchantId: merchant.id } });
      await tx.merchantMembership.create({
        data: { accountId: account.id, userId, role: "OWNER" },
      });
      await tx.merchantAuditEvent.create({
        data: { accountId: account.id, type: "account.created", actorUserId: userId },
      });

      return {
        id: account.id,
        merchantId: merchant.id,
        merchantName: merchant.name,
        website: merchant.website,
        role: "OWNER" as const,
        createdAt: account.createdAt,
      };
    });
  } catch (error) {
    // Merchant.name is globally unique; a collision means the name is taken.
    // Surface a user-safe conflict rather than leaking the Prisma error.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === P2002_UNIQUE_VIOLATION) {
      throw new MerchantConflictError(`The merchant name "${name}" is already registered`);
    }
    throw error;
  }
}

/** Every account the user is a member of, with the role they hold in each. */
export async function listMerchantAccounts(userId: string): Promise<MerchantAccountSummary[]> {
  const memberships = await prisma.merchantMembership.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
    include: { account: { include: { merchant: true } } },
  });

  return memberships.map((m) => ({
    id: m.account.id,
    merchantId: m.account.merchantId,
    merchantName: m.account.merchant.name,
    website: m.account.merchant.website,
    role: m.role,
    createdAt: m.account.createdAt,
  }));
}

/** Add a member by user id. Requires the caller to hold `members.manage`. */
export async function addMerchantMember(
  actorUserId: string,
  accountId: string,
  targetUserId: string,
  role: MerchantRole,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await requireMerchantCapability(actorUserId, accountId, "members.manage", tx);
    try {
      await tx.merchantMembership.create({ data: { accountId, userId: targetUserId, role } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === P2002_UNIQUE_VIOLATION) {
        throw new MerchantConflictError("That user is already a member of this account");
      }
      throw error;
    }
    await tx.merchantAuditEvent.create({
      data: {
        accountId,
        type: "member.added",
        actorUserId,
        metadata: { targetUserId, role },
      },
    });
  });
}

/**
 * Change an existing member's role. Requires `members.manage`, and refuses
 * to demote the last OWNER — an account with no owner can never be
 * administered again.
 */
export async function changeMerchantRole(
  actorUserId: string,
  accountId: string,
  targetUserId: string,
  role: MerchantRole,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await requireMerchantCapability(actorUserId, accountId, "members.manage", tx);

    const target = await tx.merchantMembership.findUnique({
      where: { accountId_userId: { accountId, userId: targetUserId } },
      select: { role: true },
    });
    if (!target) throw new MerchantNotFoundError("That user is not a member of this account");

    if (target.role === "OWNER" && role !== "OWNER") {
      await assertNotLastOwner(tx, accountId);
    }

    await tx.merchantMembership.update({
      where: { accountId_userId: { accountId, userId: targetUserId } },
      data: { role },
    });
    await tx.merchantAuditEvent.create({
      data: {
        accountId,
        type: "member.role_changed",
        actorUserId,
        metadata: { targetUserId, from: target.role, to: role },
      },
    });
  });
}

/** Remove a member. Requires `members.manage`; cannot remove the last OWNER. */
export async function removeMerchantMember(
  actorUserId: string,
  accountId: string,
  targetUserId: string,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await requireMerchantCapability(actorUserId, accountId, "members.manage", tx);

    const target = await tx.merchantMembership.findUnique({
      where: { accountId_userId: { accountId, userId: targetUserId } },
      select: { role: true },
    });
    if (!target) throw new MerchantNotFoundError("That user is not a member of this account");

    if (target.role === "OWNER") await assertNotLastOwner(tx, accountId);

    await tx.merchantMembership.delete({
      where: { accountId_userId: { accountId, userId: targetUserId } },
    });
    await tx.merchantAuditEvent.create({
      data: { accountId, type: "member.removed", actorUserId, metadata: { targetUserId } },
    });
  });
}

export async function listMerchantLocations(
  actorUserId: string,
  accountId: string,
): Promise<MerchantLocationSummary[]> {
  await requireMerchantCapability(actorUserId, accountId, "locations.read");
  const locations = await prisma.merchantLocation.findMany({
    where: { accountId },
    orderBy: { createdAt: "asc" },
  });
  return locations.map(toLocationSummary);
}

/** Create a location. Requires `locations.manage`. */
export async function createMerchantLocation(
  actorUserId: string,
  accountId: string,
  input: MerchantLocationInput,
): Promise<MerchantLocationSummary> {
  return prisma.$transaction(async (tx) => {
    await requireMerchantCapability(actorUserId, accountId, "locations.manage", tx);
    let location;
    try {
      location = await tx.merchantLocation.create({
        data: {
          accountId,
          externalId: input.externalId.trim(),
          displayName: input.displayName.trim(),
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === P2002_UNIQUE_VIOLATION) {
        throw new MerchantConflictError("A location with that external id already exists");
      }
      throw error;
    }
    await tx.merchantAuditEvent.create({
      data: {
        accountId,
        type: "location.created",
        actorUserId,
        metadata: { locationId: location.id, externalId: location.externalId },
      },
    });
    return toLocationSummary(location);
  });
}

/** Update a location's display name. Requires `locations.manage`. */
export async function updateMerchantLocation(
  actorUserId: string,
  accountId: string,
  locationId: string,
  input: Partial<MerchantLocationInput>,
): Promise<MerchantLocationSummary> {
  return prisma.$transaction(async (tx) => {
    await requireMerchantCapability(actorUserId, accountId, "locations.manage", tx);

    // Scope the lookup by accountId so a location id from another account is
    // a 404 here, never a cross-account update.
    const existing = await tx.merchantLocation.findFirst({ where: { id: locationId, accountId } });
    if (!existing) throw new MerchantNotFoundError("Location not found");

    const updated = await tx.merchantLocation.update({
      where: { id: locationId },
      data: {
        displayName: input.displayName?.trim() ?? existing.displayName,
        externalId: input.externalId?.trim() ?? existing.externalId,
      },
    });
    await tx.merchantAuditEvent.create({
      data: { accountId, type: "location.updated", actorUserId, metadata: { locationId } },
    });
    return toLocationSummary(updated);
  });
}

/** The audit trail for an account, newest first. Requires `account.manage`. */
export async function listMerchantAuditEvents(actorUserId: string, accountId: string) {
  await requireMerchantCapability(actorUserId, accountId, "account.manage");
  return prisma.merchantAuditEvent.findMany({
    where: { accountId },
    orderBy: { createdAt: "asc" },
  });
}

async function assertNotLastOwner(
  tx: Prisma.TransactionClient,
  accountId: string,
): Promise<void> {
  const owners = await tx.merchantMembership.count({ where: { accountId, role: "OWNER" } });
  if (owners <= 1) throw new LastOwnerError();
}

function toLocationSummary(l: {
  id: string;
  externalId: string;
  displayName: string;
  createdAt: Date;
  updatedAt: Date;
}): MerchantLocationSummary {
  return {
    id: l.id,
    externalId: l.externalId,
    displayName: l.displayName,
    createdAt: l.createdAt,
    updatedAt: l.updatedAt,
  };
}
