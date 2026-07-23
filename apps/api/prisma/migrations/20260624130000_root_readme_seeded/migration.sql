-- One-time flag: has the OpenCoperLock.txt readme been placed at the user's Drive root yet.
ALTER TABLE "User" ADD COLUMN "rootReadmeSeeded" BOOLEAN NOT NULL DEFAULT false;
