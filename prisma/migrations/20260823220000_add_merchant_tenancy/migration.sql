-- Phase 3 Session 1: merchant tenancy (ROADMAP.md Phase 3 — Merchant API / SDK).
--
-- Additive only: a new enum and four new tables, with no change to any
-- existing column — so a deployment running the previous release keeps
-- working against this schema unchanged, which is what
-- scripts/check-migration-safety.mjs enforces at PR time.

CREATE TYPE "MerchantRole" AS ENUM ('OWNER', 'ADMIN', 'DEVELOPER', 'VIEWER');

CREATE TABLE "MerchantAccount" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MerchantAccount_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MerchantAccount_merchantId_key" ON "MerchantAccount"("merchantId");

CREATE TABLE "MerchantMembership" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "MerchantRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MerchantMembership_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MerchantMembership_accountId_userId_key" ON "MerchantMembership"("accountId", "userId");
CREATE INDEX "MerchantMembership_userId_idx" ON "MerchantMembership"("userId");

CREATE TABLE "MerchantLocation" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MerchantLocation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MerchantLocation_accountId_externalId_key" ON "MerchantLocation"("accountId", "externalId");
CREATE INDEX "MerchantLocation_accountId_idx" ON "MerchantLocation"("accountId");

CREATE TABLE "MerchantAuditEvent" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "actorUserId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MerchantAuditEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MerchantAuditEvent_accountId_createdAt_idx" ON "MerchantAuditEvent"("accountId", "createdAt");

ALTER TABLE "MerchantAccount" ADD CONSTRAINT "MerchantAccount_merchantId_fkey"
    FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "MerchantMembership" ADD CONSTRAINT "MerchantMembership_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "MerchantAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MerchantMembership" ADD CONSTRAINT "MerchantMembership_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MerchantLocation" ADD CONSTRAINT "MerchantLocation_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "MerchantAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MerchantAuditEvent" ADD CONSTRAINT "MerchantAuditEvent_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "MerchantAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MerchantAuditEvent" ADD CONSTRAINT "MerchantAuditEvent_actorUserId_fkey"
    FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Append-only enforcement at the database boundary: the audit trail records
-- privileged merchant actions, so no application code path — not even a bug
-- or a compromised route — may rewrite or erase it. Reject UPDATE and DELETE
-- outright. INSERT stays allowed; that is the only legitimate operation.
CREATE OR REPLACE FUNCTION merchant_audit_events_append_only()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'MerchantAuditEvent is append-only: % is not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER merchant_audit_events_append_only
    BEFORE UPDATE OR DELETE ON "MerchantAuditEvent"
    FOR EACH ROW EXECUTE FUNCTION merchant_audit_events_append_only();
