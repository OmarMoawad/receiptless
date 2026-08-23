import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import {
  addMerchantMember,
  changeMerchantRole,
  createMerchantAccount,
  createMerchantLocation,
  listMerchantAccounts,
  listMerchantAuditEvents,
  listMerchantLocations,
  removeMerchantMember,
  updateMerchantLocation,
} from "./service";
import { LastOwnerError, MerchantConflictError, MerchantForbiddenError, MerchantNotFoundError } from "./types";

async function createUser(): Promise<string> {
  const user = await prisma.user.create({
    data: { username: `merch_${randomUUID().replace(/-/g, "").slice(0, 12)}`, passwordHash: "not-a-real-hash" },
  });
  return user.id;
}

function uniqueName(): string {
  return `Shop ${randomUUID().slice(0, 8)}`;
}

async function auditTypes(accountId: string): Promise<string[]> {
  const events = await listMerchantAuditEventsAsOwner(accountId);
  return events.map((e) => e.type);
}

// Helper that reads audit rows directly (bypassing the capability gate) so
// tests can assert the trail regardless of who is asking.
async function listMerchantAuditEventsAsOwner(accountId: string) {
  return prisma.merchantAuditEvent.findMany({ where: { accountId }, orderBy: { createdAt: "asc" } });
}

describe("merchant account lifecycle", () => {
  let owner: string;
  let outsider: string;

  beforeEach(async () => {
    owner = await createUser();
    outsider = await createUser();
  });

  it("creates a new merchant, account, OWNER membership and audit row atomically", async () => {
    const account = await createMerchantAccount(owner, { name: uniqueName(), website: "https://pilot.example" });

    expect(account.role).toBe("OWNER");
    const mine = await listMerchantAccounts(owner);
    expect(mine.map((a) => a.id)).toContain(account.id);
    expect(await auditTypes(account.id)).toEqual(["account.created"]);
  });

  it("never attaches a pre-existing Merchant row and reports a taken name as a conflict", async () => {
    const name = uniqueName();
    // Simulate an imported/consumer merchant already existing by that name.
    await prisma.merchant.create({ data: { name } });
    await expect(createMerchantAccount(owner, { name })).rejects.toBeInstanceOf(MerchantConflictError);
  });

  it("scopes accounts to their members — an outsider sees none", async () => {
    await createMerchantAccount(owner, { name: uniqueName() });
    expect(await listMerchantAccounts(outsider)).toEqual([]);
  });

  it("hides an account a caller cannot see behind a 404, not a 403", async () => {
    const account = await createMerchantAccount(owner, { name: uniqueName() });
    await expect(
      createMerchantLocation(outsider, account.id, { externalId: "L1", displayName: "Downtown" }),
    ).rejects.toBeInstanceOf(MerchantNotFoundError);
  });
});

describe("merchant roles and locations", () => {
  let owner: string;
  let viewer: string;
  let account: { id: string };

  beforeEach(async () => {
    owner = await createUser();
    viewer = await createUser();
    account = await createMerchantAccount(owner, { name: uniqueName() });
    await addMerchantMember(owner, account.id, viewer, "VIEWER");
  });

  it("lets an OWNER create a location and records it in the audit trail", async () => {
    const loc = await createMerchantLocation(owner, account.id, { externalId: "STORE-1", displayName: "Main St" });
    expect(loc.externalId).toBe("STORE-1");
    expect(await auditTypes(account.id)).toEqual(["account.created", "member.added", "location.created"]);
  });

  it("forbids a VIEWER from mutating a location (403, member but under-privileged)", async () => {
    await expect(
      createMerchantLocation(viewer, account.id, { externalId: "STORE-2", displayName: "2nd Ave" }),
    ).rejects.toBeInstanceOf(MerchantForbiddenError);
  });

  it("lets a VIEWER read locations", async () => {
    await createMerchantLocation(owner, account.id, { externalId: "STORE-3", displayName: "3rd" });
    const locations = await listMerchantLocations(viewer, account.id);
    expect(locations.map((l) => l.externalId)).toEqual(["STORE-3"]);
  });

  it("rejects a duplicate external id within the account", async () => {
    await createMerchantLocation(owner, account.id, { externalId: "DUP", displayName: "A" });
    await expect(
      createMerchantLocation(owner, account.id, { externalId: "DUP", displayName: "B" }),
    ).rejects.toBeInstanceOf(MerchantConflictError);
  });

  it("updates a location's display name", async () => {
    const loc = await createMerchantLocation(owner, account.id, { externalId: "STORE-4", displayName: "Old" });
    const updated = await updateMerchantLocation(owner, account.id, loc.id, { displayName: "New" });
    expect(updated.displayName).toBe("New");
  });
});

describe("last-owner protection", () => {
  it("refuses to demote or remove the only OWNER", async () => {
    const owner = await createUser();
    const account = await createMerchantAccount(owner, { name: uniqueName() });

    await expect(changeMerchantRole(owner, account.id, owner, "ADMIN")).rejects.toBeInstanceOf(LastOwnerError);
    await expect(removeMerchantMember(owner, account.id, owner)).rejects.toBeInstanceOf(LastOwnerError);
  });

  it("allows demoting an owner once a second owner exists", async () => {
    const owner = await createUser();
    const second = await createUser();
    const account = await createMerchantAccount(owner, { name: uniqueName() });
    await addMerchantMember(owner, account.id, second, "OWNER");

    await changeMerchantRole(owner, account.id, owner, "ADMIN");
    const roles = (await listMerchantAccounts(owner)).find((a) => a.id === account.id);
    expect(roles?.role).toBe("ADMIN");
  });
});

describe("audit trail is append-only in the database", () => {
  it("rejects UPDATE and DELETE on audit rows at the database boundary", async () => {
    const owner = await createUser();
    const account = await createMerchantAccount(owner, { name: uniqueName() });
    const [event] = await listMerchantAuditEvents(owner, account.id);

    await expect(
      prisma.merchantAuditEvent.update({ where: { id: event.id }, data: { type: "tampered" } }),
    ).rejects.toThrow(/append-only/i);
    await expect(
      prisma.merchantAuditEvent.delete({ where: { id: event.id } }),
    ).rejects.toThrow(/append-only/i);
  });
});
