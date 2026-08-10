/*
  Warnings:

  - You are about to drop the column `amount` on the `Receipt` table. All the data in the column will be lost.
  - You are about to drop the column `merchant` on the `Receipt` table. All the data in the column will be lost.
  - Added the required column `merchantId` to the `Receipt` table without a default value. This is not possible if the table is not empty.
  - Added the required column `totalMinor` to the `Receipt` table without a default value. This is not possible if the table is not empty.

*/
-- CreateTable
CREATE TABLE "Merchant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "website" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "ReceiptItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "receiptId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sku" TEXT,
    "category" TEXT NOT NULL DEFAULT 'OTHER',
    "quantity" REAL NOT NULL DEFAULT 1,
    "unitPriceMinor" INTEGER NOT NULL,
    "totalPriceMinor" INTEGER NOT NULL,
    "taxMinor" INTEGER,
    "discountMinor" INTEGER,
    "warrantyMonths" INTEGER,
    "returnWindowDays" INTEGER,
    CONSTRAINT "ReceiptItem_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "Receipt" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Receipt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "merchantId" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "subtotalMinor" INTEGER,
    "taxMinor" INTEGER,
    "discountMinor" INTEGER,
    "feeMinor" INTEGER,
    "totalMinor" INTEGER NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'OTHER',
    "purchasedAt" DATETIME NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "verification" TEXT NOT NULL DEFAULT 'UNVERIFIED',
    "claimToken" TEXT,
    "claimTokenExpiresAt" DATETIME,
    "claimedAt" DATETIME,
    "imageUrl" TEXT,
    "rawPayload" TEXT,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Receipt_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Receipt" ("category", "createdAt", "currency", "id", "imageUrl", "notes", "purchasedAt", "rawPayload", "source", "updatedAt") SELECT "category", "createdAt", "currency", "id", "imageUrl", "notes", "purchasedAt", "rawPayload", "source", "updatedAt" FROM "Receipt";
DROP TABLE "Receipt";
ALTER TABLE "new_Receipt" RENAME TO "Receipt";
CREATE UNIQUE INDEX "Receipt_claimToken_key" ON "Receipt"("claimToken");
CREATE INDEX "Receipt_purchasedAt_idx" ON "Receipt"("purchasedAt");
CREATE INDEX "Receipt_category_idx" ON "Receipt"("category");
CREATE INDEX "Receipt_merchantId_idx" ON "Receipt"("merchantId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "Merchant_name_key" ON "Merchant"("name");

-- CreateIndex
CREATE INDEX "ReceiptItem_receiptId_idx" ON "ReceiptItem"("receiptId");

-- CreateIndex
CREATE INDEX "ReceiptItem_name_idx" ON "ReceiptItem"("name");
