-- CreateTable
CREATE TABLE "AdminLastVisit" (
    "id" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "lastVisitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminLastVisit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AdminLastVisit_adminId_resource_key" ON "AdminLastVisit"("adminId", "resource");

-- AddForeignKey
ALTER TABLE "AdminLastVisit" ADD CONSTRAINT "AdminLastVisit_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
