/*
  Warnings:

  - You are about to drop the `RideGrid` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "RideGrid" DROP CONSTRAINT "RideGrid_rideId_fkey";

-- DropTable
DROP TABLE "RideGrid";
