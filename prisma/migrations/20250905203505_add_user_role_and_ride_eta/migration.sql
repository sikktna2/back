-- AlterTable
ALTER TABLE "Ride" ADD COLUMN     "etaMinutes" INTEGER;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "role" TEXT NOT NULL DEFAULT 'USER';
