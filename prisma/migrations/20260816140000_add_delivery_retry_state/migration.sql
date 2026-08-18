-- AlterTable
ALTER TABLE "InboundEmailDelivery"
  ADD COLUMN "status" TEXT NOT NULL DEFAULT 'imported',
  ADD COLUMN "failureReason" TEXT,
  ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lastAttemptAt" TIMESTAMP(3),
  ADD COLUMN "retainedEmail" JSONB;

-- Existing rows with no receipt are exactly the deliveries the parser
-- could not read (the only way to write a delivery without a receipt was
-- the unparseable branch). They are marked so they show up in the review
-- list, but they carry no retained payload — nothing kept the message —
-- so they cannot be reprocessed automatically. That is what
-- scripts/repair-legacy-receipts.mjs is for.
UPDATE "InboundEmailDelivery"
SET "status" = 'unparsed',
    "failureReason" = 'no total could be parsed from this message (recorded before the message was retained)'
WHERE "receiptId" IS NULL;

-- CreateIndex
CREATE INDEX "InboundEmailDelivery_status_idx" ON "InboundEmailDelivery"("status");
