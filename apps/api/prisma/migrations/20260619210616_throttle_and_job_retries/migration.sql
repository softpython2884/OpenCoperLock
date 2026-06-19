-- AlterTable
ALTER TABLE "RemoteUploadJob" ADD COLUMN     "attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "nextRunAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "Throttle" (
    "id" TEXT NOT NULL,
    "bucket" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "failures" INTEGER NOT NULL DEFAULT 0,
    "firstFailAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedUntil" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Throttle_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Throttle_lockedUntil_idx" ON "Throttle"("lockedUntil");

-- CreateIndex
CREATE UNIQUE INDEX "Throttle_bucket_key_key" ON "Throttle"("bucket", "key");

-- CreateIndex
CREATE INDEX "RemoteUploadJob_status_nextRunAt_idx" ON "RemoteUploadJob"("status", "nextRunAt");
