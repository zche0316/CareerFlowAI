CREATE TABLE "CoachReview" (
  "id" TEXT PRIMARY KEY, "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "profileId" TEXT NOT NULL, "mode" TEXT NOT NULL, "analysis" JSONB NOT NULL,
  "calls" INTEGER NOT NULL DEFAULT 0, "inputTokens" INTEGER NOT NULL DEFAULT 0, "outputTokens" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "CoachReview_userId_createdAt_idx" ON "CoachReview"("userId", "createdAt");
