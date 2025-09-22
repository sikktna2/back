/*
  Warnings:

  - You are about to drop the column `balance` on the `User` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "User" DROP COLUMN "balance",
ADD COLUMN     "driverLicenseExpiryDate" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "CarLicenseHistory" (
    "id" TEXT NOT NULL,
    "photoUrl" TEXT NOT NULL,
    "status" "VerificationStatus" NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "carId" TEXT NOT NULL,

    CONSTRAINT "CarLicenseHistory_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "CarLicenseHistory" ADD CONSTRAINT "CarLicenseHistory_carId_fkey" FOREIGN KEY ("carId") REFERENCES "Car"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
