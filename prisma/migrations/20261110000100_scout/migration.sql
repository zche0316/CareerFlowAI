CREATE TABLE "ScoutSetting" (
  "userId" TEXT PRIMARY KEY REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "enabled" BOOLEAN NOT NULL DEFAULT false, "topK" INTEGER NOT NULL DEFAULT 3, "minScore" INTEGER NOT NULL DEFAULT 50,
  "search" JSONB NOT NULL, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE TABLE "ScoutSweep" (
  "id" TEXT PRIMARY KEY, "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "status" TEXT NOT NULL DEFAULT 'QUEUED', "trigger" TEXT NOT NULL, "mode" TEXT NOT NULL, "data" JSONB NOT NULL,
  "calls" INTEGER NOT NULL DEFAULT 0, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "ScoutSweep_userId_createdAt_idx" ON "ScoutSweep"("userId", "createdAt");
CREATE TABLE "TrackedJob" (
  "id" TEXT PRIMARY KEY, "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "fingerprint" TEXT NOT NULL, "sweepId" TEXT, "record" JSONB NOT NULL,
  "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "TrackedJob_userId_fingerprint_key" ON "TrackedJob"("userId", "fingerprint");
CREATE INDEX "TrackedJob_userId_firstSeenAt_idx" ON "TrackedJob"("userId", "firstSeenAt");
