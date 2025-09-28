-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "bookedById" TEXT,
ADD COLUMN     "bookingGroupId" TEXT;

-- CreateIndex
CREATE INDEX "Booking_bookingGroupId_idx" ON "Booking"("bookingGroupId");

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_bookedById_fkey" FOREIGN KEY ("bookedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
