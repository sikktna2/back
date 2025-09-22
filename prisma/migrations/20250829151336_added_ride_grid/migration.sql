-- CreateTable
CREATE TABLE "RideGrid" (
    "id" TEXT NOT NULL,
    "rideId" TEXT NOT NULL,
    "gridKey" TEXT NOT NULL,

    CONSTRAINT "RideGrid_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RideGrid_gridKey_idx" ON "RideGrid"("gridKey");

-- CreateIndex
CREATE UNIQUE INDEX "RideGrid_rideId_gridKey_key" ON "RideGrid"("rideId", "gridKey");

-- AddForeignKey
ALTER TABLE "RideGrid" ADD CONSTRAINT "RideGrid_rideId_fkey" FOREIGN KEY ("rideId") REFERENCES "Ride"("id") ON DELETE CASCADE ON UPDATE CASCADE;
