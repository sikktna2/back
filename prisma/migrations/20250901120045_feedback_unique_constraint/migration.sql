/*
  Warnings:

  - A unique constraint covering the columns `[rideId,givenById]` on the table `Feedback` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "Feedback_rideId_givenById_key" ON "Feedback"("rideId", "givenById");
