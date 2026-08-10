-- CreateTable
CREATE TABLE "Receipt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "merchant" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "category" TEXT NOT NULL DEFAULT 'OTHER',
    "purchasedAt" DATETIME NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "imageUrl" TEXT,
    "rawPayload" TEXT,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "Receipt_purchasedAt_idx" ON "Receipt"("purchasedAt");

-- CreateIndex
CREATE INDEX "Receipt_category_idx" ON "Receipt"("category");
