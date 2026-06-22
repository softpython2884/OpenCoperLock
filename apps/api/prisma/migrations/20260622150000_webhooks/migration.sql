-- CreateTable
CREATE TABLE "Webhook" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "secret" TEXT,
    "folderId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastStatus" INTEGER,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Webhook_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Webhook_ownerId_idx" ON "Webhook"("ownerId");

-- AddForeignKey
ALTER TABLE "Webhook" ADD CONSTRAINT "Webhook_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
