-- Session 6: owner-defined category rules.
-- Additive only: a new enum, a new table, no change to existing columns —
-- so an older deployment keeps running against this schema unchanged,
-- which is what scripts/check-migration-safety.mjs enforces.

CREATE TYPE "RuleTarget" AS ENUM ('MERCHANT', 'ITEM');

CREATE TABLE "CategoryRule" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "pattern" TEXT NOT NULL,
    "category" "Category" NOT NULL,
    "target" "RuleTarget" NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CategoryRule_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CategoryRule_ownerId_target_pattern_key"
    ON "CategoryRule"("ownerId", "target", "pattern");

CREATE INDEX "CategoryRule_ownerId_idx" ON "CategoryRule"("ownerId");

ALTER TABLE "CategoryRule" ADD CONSTRAINT "CategoryRule_ownerId_fkey"
    FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
