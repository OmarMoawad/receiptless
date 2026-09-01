import type { MerchantRole } from "@/generated/prisma/client";

/**
 * Phase 3 Session 1 — merchant tenancy shared types and errors.
 *
 * The two error classes carry the *HTTP intent* the route layer maps to, so
 * that authorization decisions live in one place. A caller who is not a
 * member of an account gets `MerchantNotFoundError` (404), never
 * `MerchantForbiddenError` (403): existence of an account a person cannot
 * see is itself information, so a non-member and a nonexistent account are
 * indistinguishable from outside. 403 is reserved for a *member* whose role
 * is too low for the specific action.
 */

export type MerchantCapability =
  | "account.manage"
  | "members.manage"
  | "locations.manage"
  | "locations.read"
  | "keys.manage";

/**
 * The exact role → capability matrix. DEVELOPER can manage keys (Session 2's
 * API keys) and read locations but cannot change membership or locations;
 * VIEWER can only read. Kept as data, not scattered `if (role === …)` checks,
 * so the whole authority model is auditable in one glance.
 */
export const ROLE_CAPABILITIES: Record<MerchantRole, readonly MerchantCapability[]> = {
  OWNER: ["account.manage", "members.manage", "locations.manage", "locations.read", "keys.manage"],
  ADMIN: ["members.manage", "locations.manage", "locations.read", "keys.manage"],
  DEVELOPER: ["locations.read", "keys.manage"],
  VIEWER: ["locations.read"],
} as const;

export function roleHasCapability(role: MerchantRole, capability: MerchantCapability): boolean {
  return ROLE_CAPABILITIES[role].includes(capability);
}

/** The caller cannot see this account (not a member, or it does not exist). Maps to 404. */
export class MerchantNotFoundError extends Error {
  constructor(message = "Merchant account not found") {
    super(message);
    this.name = "MerchantNotFoundError";
  }
}

/** The caller is a member but their role is too low for this action. Maps to 403. */
export class MerchantForbiddenError extends Error {
  constructor(message = "Insufficient merchant role") {
    super(message);
    this.name = "MerchantForbiddenError";
  }
}

/** A user-safe conflict — e.g. a merchant name already taken. Maps to 409. */
export class MerchantConflictError extends Error {
  constructor(message = "Merchant already exists") {
    super(message);
    this.name = "MerchantConflictError";
  }
}

/** An action that would remove the last OWNER of an account. Maps to 409. */
export class LastOwnerError extends Error {
  constructor(message = "An account must keep at least one owner") {
    super(message);
    this.name = "LastOwnerError";
  }
}

export type CreateMerchantAccountInput = {
  name: string;
  website?: string | null;
};

export type MerchantLocationInput = {
  externalId: string;
  displayName: string;
};

export type { MerchantRole };
