-- A role's own posting identity (source listing id or cleaned link) and a short description
-- signature, so the same posting is recognised across boards and same-title openings stay apart.
ALTER TABLE "Application" ADD COLUMN "postingKey" TEXT, ADD COLUMN "textSig" JSONB;
ALTER TABLE "TrackedJob" ADD COLUMN "postingKey" TEXT, ADD COLUMN "textSig" JSONB;
CREATE INDEX "Application_userId_postingKey_idx" ON "Application"("userId", "postingKey");
CREATE INDEX "TrackedJob_userId_postingKey_idx" ON "TrackedJob"("userId", "postingKey");
