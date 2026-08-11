-- AlterTable
ALTER TABLE "Receipt" ADD COLUMN     "ownerId" TEXT;

-- CreateIndex
CREATE INDEX "Receipt_ownerId_idx" ON "Receipt"("ownerId");

-- AddForeignKey
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
