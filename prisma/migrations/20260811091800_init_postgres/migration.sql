-- CreateEnum
CREATE TYPE "ReceiptSource" AS ENUM ('QR', 'PHOTO', 'MANUAL', 'NFC', 'BLUETOOTH', 'EMAIL', 'POS_API');

-- CreateEnum
CREATE TYPE "Category" AS ENUM ('GROCERIES', 'DINING', 'TRANSPORT', 'UTILITIES', 'HEALTH', 'SHOPPING', 'ENTERTAINMENT', 'TRAVEL', 'EDUCATION', 'OTHER');

-- CreateEnum
CREATE TYPE "VerificationLevel" AS ENUM ('UNVERIFIED', 'IMPORTED', 'MERCHANT_VERIFIED');

-- CreateTable
CREATE TABLE "Merchant" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "website" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Merchant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Receipt" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "subtotalMinor" INTEGER,
    "taxMinor" INTEGER,
    "discountMinor" INTEGER,
    "feeMinor" INTEGER,
    "totalMinor" INTEGER NOT NULL,
    "category" "Category" NOT NULL DEFAULT 'OTHER',
    "purchasedAt" TIMESTAMP(3) NOT NULL,
    "source" "ReceiptSource" NOT NULL DEFAULT 'MANUAL',
    "verification" "VerificationLevel" NOT NULL DEFAULT 'UNVERIFIED',
    "claimToken" TEXT,
    "claimTokenExpiresAt" TIMESTAMP(3),
    "claimedAt" TIMESTAMP(3),
    "imageUrl" TEXT,
    "rawPayload" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Receipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReceiptItem" (
    "id" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sku" TEXT,
    "category" "Category" NOT NULL DEFAULT 'OTHER',
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "unitPriceMinor" INTEGER NOT NULL,
    "totalPriceMinor" INTEGER NOT NULL,
    "taxMinor" INTEGER,
    "discountMinor" INTEGER,
    "warrantyMonths" INTEGER,
    "returnWindowDays" INTEGER,

    CONSTRAINT "ReceiptItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Merchant_name_key" ON "Merchant"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Receipt_claimToken_key" ON "Receipt"("claimToken");

-- CreateIndex
CREATE INDEX "Receipt_purchasedAt_idx" ON "Receipt"("purchasedAt");

-- CreateIndex
CREATE INDEX "Receipt_category_idx" ON "Receipt"("category");

-- CreateIndex
CREATE INDEX "Receipt_merchantId_idx" ON "Receipt"("merchantId");

-- CreateIndex
CREATE INDEX "ReceiptItem_receiptId_idx" ON "ReceiptItem"("receiptId");

-- CreateIndex
CREATE INDEX "ReceiptItem_name_idx" ON "ReceiptItem"("name");

-- AddForeignKey
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiptItem" ADD CONSTRAINT "ReceiptItem_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "Receipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;
