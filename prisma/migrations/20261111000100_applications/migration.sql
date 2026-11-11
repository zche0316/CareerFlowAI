CREATE TABLE "Application" (
  "id" TEXT PRIMARY KEY, "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "fingerprint" TEXT NOT NULL, "job" JSONB NOT NULL, "source" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'saved', "history" JSONB NOT NULL, "notes" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "Application_userId_fingerprint_key" ON "Application"("userId", "fingerprint");
CREATE INDEX "Application_userId_updatedAt_idx" ON "Application"("userId", "updatedAt");
ALTER TABLE "Mission" ADD COLUMN "applicationId" TEXT;
CREATE INDEX "Mission_applicationId_idx" ON "Mission"("applicationId");
