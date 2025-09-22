/*
  Warnings:

  - A unique constraint covering the columns `[referrerId,refereeId]` on the table `Referral` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "Referral_code_key";

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "profileImageLocked" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE UNIQUE INDEX "Referral_referrerId_refereeId_key" ON "Referral"("referrerId", "refereeId");
