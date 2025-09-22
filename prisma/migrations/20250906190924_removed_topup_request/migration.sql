/*
  Warnings:

  - You are about to drop the `TopUpRequest` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "TopUpRequest" DROP CONSTRAINT "TopUpRequest_userId_fkey";

-- DropTable
DROP TABLE "TopUpRequest";

-- DropEnum
DROP TYPE "PaymentStatus";
