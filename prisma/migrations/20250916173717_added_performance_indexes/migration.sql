-- CreateIndex
CREATE INDEX "Booking_rideId_idx" ON "Booking"("rideId");

-- CreateIndex
CREATE INDEX "Booking_userId_idx" ON "Booking"("userId");

-- CreateIndex
CREATE INDEX "Booking_status_idx" ON "Booking"("status");

-- CreateIndex
CREATE INDEX "Car_isVerified_idx" ON "Car"("isVerified");

-- CreateIndex
CREATE INDEX "Notification_userId_isRead_type_idx" ON "Notification"("userId", "isRead", "type");

-- CreateIndex
CREATE INDEX "Ride_status_idx" ON "Ride"("status");

-- CreateIndex
CREATE INDEX "Ride_driverId_idx" ON "Ride"("driverId");

-- CreateIndex
CREATE INDEX "Ride_time_idx" ON "Ride"("time");

-- CreateIndex
CREATE INDEX "Ride_fromCityNorm_toCityNorm_time_idx" ON "Ride"("fromCityNorm", "toCityNorm", "time");

-- CreateIndex
CREATE INDEX "Ride_isRequest_idx" ON "Ride"("isRequest");

-- Create GIST indexes for PostGIS geography columns
CREATE INDEX "Ride_originGeom_gist_idx" ON "Ride" USING GIST ("originGeom");
CREATE INDEX "Ride_destinationGeom_gist_idx" ON "Ride" USING GIST ("destinationGeom");
CREATE INDEX "Ride_routeGeom_gist_idx" ON "Ride" USING GIST ("routeGeom");