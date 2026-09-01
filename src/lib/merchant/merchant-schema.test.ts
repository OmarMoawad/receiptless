import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Phase 3 Session 1 — merchant tenancy schema.
 *
 * These assertions guard the *shape* the service layer depends on: the four
 * models exist, membership is one-per-(account,user), a merchant is claimed
 * at most once, and the audit trail is protected against rewriting at the
 * database boundary rather than only in application code. They read the
 * schema and migration files directly, the same way schema-drift.test.ts
 * reasons about migrations without needing a live database.
 */

const here = dirname(fileURLToPath(import.meta.url));
const schema = readFileSync(resolve(here, "../../../prisma/schema.prisma"), "utf8");

const models = [...schema.matchAll(/^model\s+(\w+)/gm)].map((m) => m[1]);

const migrationsDir = resolve(here, "../../../prisma/migrations");
const merchantMigrationDir = readdirSync(migrationsDir).find((d) => d.includes("merchant_tenancy"));
const migration = merchantMigrationDir
  ? readFileSync(join(migrationsDir, merchantMigrationDir, "migration.sql"), "utf8")
  : "";

describe("merchant tenancy schema", () => {
  it("declares every merchant model", () => {
    expect(models).toContain("MerchantAccount");
    expect(models).toContain("MerchantMembership");
    expect(models).toContain("MerchantLocation");
    expect(models).toContain("MerchantAuditEvent");
  });

  it("declares the exact four-value role enum", () => {
    const roleEnum = schema.match(/enum\s+MerchantRole\s*\{([^}]*)\}/);
    expect(roleEnum).not.toBeNull();
    const values = (roleEnum?.[1] ?? "").split(/\s+/).filter(Boolean);
    expect(values).toEqual(["OWNER", "ADMIN", "DEVELOPER", "VIEWER"]);
  });

  it("claims a merchant at most once and holds one role per account member", () => {
    expect(migration).toContain('UNIQUE INDEX "MerchantAccount_merchantId_key"');
    expect(migration).toMatch(/UNIQUE INDEX "MerchantMembership_accountId_userId_key"[\s\S]*?"accountId", "userId"/);
    expect(migration).toMatch(/UNIQUE INDEX "MerchantLocation_accountId_externalId_key"[\s\S]*?"accountId", "externalId"/);
  });

  it("makes the audit trail append-only in the database", () => {
    expect(migration).toContain("merchant_audit_events_append_only");
    expect(migration).toMatch(/BEFORE\s+UPDATE\s+OR\s+DELETE\s+ON\s+"MerchantAuditEvent"/i);
  });

  it("keeps the migration additive", () => {
    // The safety net that scripts/check-migration-safety.mjs also enforces —
    // asserted here too so a future edit to this migration is caught in the
    // unit run, not only at PR time.
    expect(migration).not.toMatch(/DROP\s+(TABLE|COLUMN)/i);
    expect(migration).not.toMatch(/ALTER\s+COLUMN[\s\S]{0,80}?SET\s+NOT\s+NULL/i);
  });
});
