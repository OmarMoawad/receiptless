/*
  Warnings:

  - You are about to drop the column `imageUrl` on the `Receipt` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Receipt" DROP COLUMN "imageUrl",
ADD COLUMN     "imageKey" TEXT;
