-- DropIndex
DROP INDEX "Ride_destinationGeom_gist_idx";

-- DropIndex
DROP INDEX "Ride_originGeom_gist_idx";

-- DropIndex
DROP INDEX "Ride_routeGeom_gist_idx";

-- CreateTable
CREATE TABLE "RideComment" (
    "id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rideId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "parentId" TEXT,

    CONSTRAINT "RideComment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RideComment_rideId_createdAt_idx" ON "RideComment"("rideId", "createdAt");

-- AddForeignKey
ALTER TABLE "RideComment" ADD CONSTRAINT "RideComment_rideId_fkey" FOREIGN KEY ("rideId") REFERENCES "Ride"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RideComment" ADD CONSTRAINT "RideComment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RideComment" ADD CONSTRAINT "RideComment_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "RideComment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
