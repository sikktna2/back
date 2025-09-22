/*
  Warnings:

  - You are about to drop the column `didArriveOnTime` on the `Feedback` table. All the data in the column will be lost.
  - You are about to drop the column `didStartOnTime` on the `Feedback` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Feedback" DROP COLUMN "didArriveOnTime",
DROP COLUMN "didStartOnTime",
ADD COLUMN     "arrivalOnTime" BOOLEAN,
ADD COLUMN     "startOnTime" BOOLEAN;
