-- CreateEnum
CREATE TYPE "SpaceRole" AS ENUM ('EDITOR', 'VIEWER');

-- CreateTable
CREATE TABLE "SharedSpace" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SharedSpace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SharedSpaceMember" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "SpaceRole" NOT NULL DEFAULT 'VIEWER',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SharedSpaceMember_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "Folder" ADD COLUMN "spaceId" TEXT;

-- AlterTable
ALTER TABLE "FileObject" ADD COLUMN "spaceId" TEXT;

-- CreateIndex
CREATE INDEX "SharedSpace_ownerId_idx" ON "SharedSpace"("ownerId");

-- CreateIndex
CREATE INDEX "SharedSpaceMember_spaceId_idx" ON "SharedSpaceMember"("spaceId");

-- CreateIndex
CREATE INDEX "SharedSpaceMember_userId_idx" ON "SharedSpaceMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "SharedSpaceMember_spaceId_userId_key" ON "SharedSpaceMember"("spaceId", "userId");

-- CreateIndex
CREATE INDEX "Folder_spaceId_idx" ON "Folder"("spaceId");

-- CreateIndex
CREATE INDEX "FileObject_spaceId_idx" ON "FileObject"("spaceId");

-- AddForeignKey
ALTER TABLE "SharedSpace" ADD CONSTRAINT "SharedSpace_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SharedSpaceMember" ADD CONSTRAINT "SharedSpaceMember_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "SharedSpace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SharedSpaceMember" ADD CONSTRAINT "SharedSpaceMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Folder" ADD CONSTRAINT "Folder_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "SharedSpace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileObject" ADD CONSTRAINT "FileObject_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "SharedSpace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
