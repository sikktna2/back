/*
  Warnings:

  - You are about to drop the column `bookedById` on the `Booking` table. All the data in the column will be lost.
  - You are about to drop the column `bookingGroupId` on the `Booking` table. All the data in the column will be lost.
  - You are about to drop the column `screenshot` on the `Booking` table. All the data in the column will be lost.
  - You are about to drop the column `seatsBooked` on the `Booking` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[rideId,userId]` on the table `Booking` will be added. If there are existing duplicate values, this will fail.

*/
-- DropForeignKey
ALTER TABLE "Booking" DROP CONSTRAINT "Booking_bookedById_fkey";

-- DropIndex
DROP INDEX "Booking_bookingGroupId_idx";

-- AlterTable
ALTER TABLE "Booking" DROP COLUMN "bookedById",
DROP COLUMN "bookingGroupId",
DROP COLUMN "screenshot",
DROP COLUMN "seatsBooked",
ADD COLUMN     "invitationId" TEXT;

-- CreateTable
CREATE TABLE "GroupBookingInvitation" (
    "id" TEXT NOT NULL,
    "rideId" TEXT NOT NULL,
    "initiatorId" TEXT NOT NULL,
    "seats" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',

    CONSTRAINT "GroupBookingInvitation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GroupBookingInvitation_rideId_idx" ON "GroupBookingInvitation"("rideId");

-- CreateIndex
CREATE INDEX "GroupBookingInvitation_initiatorId_idx" ON "GroupBookingInvitation"("initiatorId");

-- CreateIndex
CREATE INDEX "Booking_invitationId_idx" ON "Booking"("invitationId");

-- CreateIndex
CREATE UNIQUE INDEX "Booking_rideId_userId_key" ON "Booking"("rideId", "userId");

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_invitationId_fkey" FOREIGN KEY ("invitationId") REFERENCES "GroupBookingInvitation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupBookingInvitation" ADD CONSTRAINT "GroupBookingInvitation_rideId_fkey" FOREIGN KEY ("rideId") REFERENCES "Ride"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupBookingInvitation" ADD CONSTRAINT "GroupBookingInvitation_initiatorId_fkey" FOREIGN KEY ("initiatorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
