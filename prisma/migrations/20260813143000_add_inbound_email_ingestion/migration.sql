-- CreateTable
CREATE TABLE "InboundEmailAddress" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "mailboxToken" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InboundEmailAddress_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InboundEmailAddress_userId_key" ON "InboundEmailAddress"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "InboundEmailAddress_mailboxToken_key" ON "InboundEmailAddress"("mailboxToken");

-- AddForeignKey
ALTER TABLE "InboundEmailAddress" ADD CONSTRAINT "InboundEmailAddress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
