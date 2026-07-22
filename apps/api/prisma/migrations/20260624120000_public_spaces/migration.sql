-- AlterEnum
ALTER TYPE "EncMode" ADD VALUE 'PUBLIC';

-- AlterTable
ALTER TABLE "Folder" ADD COLUMN "isPublic" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "FileObject" ADD COLUMN "publicSlug" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "FileObject_publicSlug_key" ON "FileObject"("publicSlug");
