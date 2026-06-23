-- AlterTable
ALTER TABLE "User" ADD COLUMN "lastSeenVersion" TEXT;

-- AlterTable
ALTER TABLE "Setting" ADD COLUMN "autoUpdateEnabled" BOOLEAN NOT NULL DEFAULT false;
