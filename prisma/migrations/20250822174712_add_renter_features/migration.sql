/*
  Warnings:

  - The `status` column on the `Booking` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `status` column on the `Offer` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `status` column on the `Ride` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - Added the required column `destinationLat` to the `Ride` table without a default value. This is not possible if the table is not empty.
  - Added the required column `destinationLng` to the `Ride` table without a default value. This is not possible if the table is not empty.
  - Added the required column `originLat` to the `Ride` table without a default value. This is not possible if the table is not empty.
  - Added the required column `originLng` to the `Ride` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "RideStatus" AS ENUM ('UPCOMING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "OfferStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED');

-- DropForeignKey
ALTER TABLE "Chat" DROP CONSTRAINT "Chat_rideId_fkey";

-- AlterTable
ALTER TABLE "Booking" DROP COLUMN "status",
ADD COLUMN     "status" "BookingStatus" NOT NULL DEFAULT 'PENDING';

-- AlterTable
ALTER TABLE "Chat" ALTER COLUMN "rideId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Offer" DROP COLUMN "status",
ADD COLUMN     "status" "OfferStatus" NOT NULL DEFAULT 'PENDING';

-- AlterTable
ALTER TABLE "Ride" ADD COLUMN     "destinationLat" DOUBLE PRECISION NOT NULL,
ADD COLUMN     "destinationLng" DOUBLE PRECISION NOT NULL,
ADD COLUMN     "originLat" DOUBLE PRECISION NOT NULL,
ADD COLUMN     "originLng" DOUBLE PRECISION NOT NULL,
ADD COLUMN     "polyline" TEXT,
ADD COLUMN     "renterScreenshotUrl" TEXT,
DROP COLUMN "status",
ADD COLUMN     "status" "RideStatus" NOT NULL DEFAULT 'UPCOMING';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "currentLat" DOUBLE PRECISION,
ADD COLUMN     "currentLng" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "RideInterest" (
    "id" TEXT NOT NULL,
    "rideId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RideInterest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RideInterest_rideId_userId_key" ON "RideInterest"("rideId", "userId");

-- AddForeignKey
ALTER TABLE "RideInterest" ADD CONSTRAINT "RideInterest_rideId_fkey" FOREIGN KEY ("rideId") REFERENCES "Ride"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RideInterest" ADD CONSTRAINT "RideInterest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Chat" ADD CONSTRAINT "Chat_rideId_fkey" FOREIGN KEY ("rideId") REFERENCES "Ride"("id") ON DELETE SET NULL ON UPDATE CASCADE;
