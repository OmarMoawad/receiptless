-- CreateTable
CREATE TABLE "InboundEmailDelivery" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerMessageId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "receiptId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InboundEmailDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InboundEmailDelivery_receiptId_key" ON "InboundEmailDelivery"("receiptId");

-- CreateIndex
CREATE UNIQUE INDEX "InboundEmailDelivery_provider_providerMessageId_key" ON "InboundEmailDelivery"("provider", "providerMessageId");

-- CreateIndex
CREATE INDEX "InboundEmailDelivery_userId_idx" ON "InboundEmailDelivery"("userId");

-- AddForeignKey
ALTER TABLE "InboundEmailDelivery" ADD CONSTRAINT "InboundEmailDelivery_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboundEmailDelivery" ADD CONSTRAINT "InboundEmailDelivery_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "Receipt"("id") ON DELETE SET NULL ON UPDATE CASCADE;
