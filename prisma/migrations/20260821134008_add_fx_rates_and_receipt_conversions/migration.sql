-- NOTE: `prisma migrate dev` generated a `DROP INDEX "Receipt_searchVector_idx"`
-- at the top of this file and it has been removed deliberately.
--
-- That index is the GIN index behind session 3's full-text search, created
-- by the 20260819100000_add_receipt_search_vector migration in raw SQL.
-- Prisma proposes dropping it on every diff because `searchVector` is an
-- `Unsupported("tsvector")` column it cannot model, so the index is invisible
-- to the schema and reads as drift. Applying it would silently turn every
-- search into a sequential scan — no error, no failing test, just a query
-- plan that degrades with the size of a vault. Re-check for this line
-- whenever a migration is generated against this schema.

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "reportingCurrency" TEXT NOT NULL DEFAULT 'USD';

-- CreateTable
CREATE TABLE "FxRate" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT,
    "base" TEXT NOT NULL,
    "quote" TEXT NOT NULL,
    "effectiveDate" DATE NOT NULL,
    "rate" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourcePolicyVersion" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3),
    "enteredAt" TIMESTAMP(3),
    "actorUserId" TEXT,
    "reason" TEXT,
    "providerReference" TEXT,
    "supersedesId" TEXT,
    "supersededAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FxRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReceiptConversion" (
    "id" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "parentId" TEXT,
    "approved" BOOLEAN NOT NULL DEFAULT true,
    "sourceCurrency" TEXT NOT NULL,
    "targetCurrency" TEXT NOT NULL,
    "sourceScale" INTEGER NOT NULL,
    "targetScale" INTEGER NOT NULL,
    "currencyMetadataVersion" TEXT NOT NULL,
    "rate" TEXT NOT NULL,
    "rateSource" TEXT NOT NULL,
    "rateEffectiveDate" DATE NOT NULL,
    "ratePolicyVersion" TEXT NOT NULL,
    "conversionPolicyVersion" TEXT NOT NULL,
    "unroundedResult" TEXT NOT NULL,
    "totalTargetMinor" INTEGER NOT NULL,
    "fxRateId" TEXT,
    "operator" TEXT,
    "reason" TEXT,
    "correlationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReceiptConversion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FxRate_supersedesId_key" ON "FxRate"("supersedesId");

-- CreateIndex
CREATE INDEX "FxRate_ownerId_base_quote_effectiveDate_idx" ON "FxRate"("ownerId", "base", "quote", "effectiveDate");

-- CreateIndex
CREATE INDEX "FxRate_base_quote_effectiveDate_idx" ON "FxRate"("base", "quote", "effectiveDate");

-- CreateIndex
CREATE UNIQUE INDEX "ReceiptConversion_parentId_key" ON "ReceiptConversion"("parentId");

-- CreateIndex
CREATE INDEX "ReceiptConversion_receiptId_idx" ON "ReceiptConversion"("receiptId");

-- CreateIndex
CREATE UNIQUE INDEX "ReceiptConversion_receiptId_version_key" ON "ReceiptConversion"("receiptId", "version");

-- AddForeignKey
ALTER TABLE "FxRate" ADD CONSTRAINT "FxRate_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FxRate" ADD CONSTRAINT "FxRate_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "FxRate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiptConversion" ADD CONSTRAINT "ReceiptConversion_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "Receipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiptConversion" ADD CONSTRAINT "ReceiptConversion_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "ReceiptConversion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiptConversion" ADD CONSTRAINT "ReceiptConversion_fxRateId_fkey" FOREIGN KEY ("fxRateId") REFERENCES "FxRate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Partial unique indexes: Prisma cannot express these declaratively, and
-- they are what make the resolver deterministic rather than dependent on
-- row order. Without them "the active rate for this key" is whatever the
-- query happened to return first.

-- At most one ACTIVE manual rate per owner, per currency pair, per date.
-- A correction supersedes the previous row rather than updating it, so the
-- history stays intact and only one row is ever live.
CREATE UNIQUE INDEX "FxRate_active_manual_key"
    ON "FxRate" ("ownerId", "base", "quote", "effectiveDate")
    WHERE "supersededAt" IS NULL AND "ownerId" IS NOT NULL;

-- At most one ACTIVE provider rate per source, per currency pair, per date.
-- Keyed on source as well, so two providers can both hold a rate for the
-- same day without colliding — the resolver picks between them by the
-- configured source policy, not by chance.
CREATE UNIQUE INDEX "FxRate_active_provider_key"
    ON "FxRate" ("source", "base", "quote", "effectiveDate")
    WHERE "supersededAt" IS NULL AND "ownerId" IS NULL;

-- Exactly one APPROVED conversion version per receipt. Reports select on
-- this, so two approved versions would mean a receipt has two different
-- converted totals and the report picks one arbitrarily.
CREATE UNIQUE INDEX "ReceiptConversion_approved_key"
    ON "ReceiptConversion" ("receiptId")
    WHERE "approved";
