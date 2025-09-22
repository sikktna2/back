-- CreateTable
CREATE TABLE "UserStats" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "onTimeStarts" INTEGER NOT NULL DEFAULT 0,
    "onTimeArrivals" INTEGER NOT NULL DEFAULT 0,
    "totalChatMessages" INTEGER NOT NULL DEFAULT 0,
    "fastResponses" INTEGER NOT NULL DEFAULT 0,
    "totalBookingsToAccept" INTEGER NOT NULL DEFAULT 0,
    "acceptedBookings" INTEGER NOT NULL DEFAULT 0,
    "totalCancellations" INTEGER NOT NULL DEFAULT 0,
    "totalRidesAsDriver" INTEGER NOT NULL DEFAULT 0,
    "totalRidesAsPassenger" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "UserStats_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserStats_userId_key" ON "UserStats"("userId");

-- AddForeignKey
ALTER TABLE "UserStats" ADD CONSTRAINT "UserStats_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
