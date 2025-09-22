-- AlterTable
ALTER TABLE "Feedback" ADD COLUMN     "didArriveOnTime" BOOLEAN,
ADD COLUMN     "didStartOnTime" BOOLEAN;

-- AlterTable
ALTER TABLE "UserStats" ADD COLUMN     "fastResponseOpportunities" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "fastResponseSuccesses" INTEGER NOT NULL DEFAULT 0;
