CREATE TABLE "ProfileThread" (
  "id" TEXT PRIMARY KEY, "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "title" TEXT NOT NULL, "messages" JSONB NOT NULL, "proposals" JSONB NOT NULL, "workingForm" JSONB NOT NULL,
  "profileVersion" INTEGER NOT NULL, "revision" INTEGER NOT NULL DEFAULT 0, "busyToken" TEXT, "busyUntil" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "ProfileThread_userId_updatedAt_idx" ON "ProfileThread"("userId", "updatedAt");
CREATE TABLE "CareerMemory" (
  "id" TEXT PRIMARY KEY, "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "kind" TEXT NOT NULL, "title" TEXT NOT NULL, "text" TEXT NOT NULL, "star" JSONB NOT NULL, "source" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT', "recordId" TEXT, "missionId" TEXT, "supersedesId" TEXT,
  "revision" INTEGER NOT NULL DEFAULT 1, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "CareerMemory_userId_status_idx" ON "CareerMemory"("userId", "status");
CREATE TABLE "ResumeWording" (
  "id" TEXT PRIMARY KEY, "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "resumeId" TEXT NOT NULL, "factId" TEXT NOT NULL, "sourceHash" TEXT NOT NULL, "before" TEXT NOT NULL,
  "after" TEXT NOT NULL, "reason" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'PENDING', "model" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "ResumeWording_userId_resumeId_idx" ON "ResumeWording"("userId", "resumeId");
