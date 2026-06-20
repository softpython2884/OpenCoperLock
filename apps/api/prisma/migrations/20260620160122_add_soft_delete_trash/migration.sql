-- AlterTable
ALTER TABLE "FileObject" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Folder" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "FileObject_deletedAt_idx" ON "FileObject"("deletedAt");

-- CreateIndex
CREATE INDEX "Folder_deletedAt_idx" ON "Folder"("deletedAt");
