-- AlterTable
ALTER TABLE "Ride" ADD COLUMN     "scheduledRideId" TEXT;

-- AddForeignKey
ALTER TABLE "Ride" ADD CONSTRAINT "Ride_scheduledRideId_fkey" FOREIGN KEY ("scheduledRideId") REFERENCES "ScheduledRide"("id") ON DELETE CASCADE ON UPDATE CASCADE;
