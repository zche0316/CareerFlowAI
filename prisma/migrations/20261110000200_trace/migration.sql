CREATE TABLE "TraceSpan" (
  "id" TEXT PRIMARY KEY, "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "missionId" TEXT, "sweepId" TEXT, "agent" TEXT NOT NULL, "role" TEXT NOT NULL, "model" TEXT NOT NULL, "mode" TEXT NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL, "durationMs" INTEGER NOT NULL, "attempts" INTEGER NOT NULL,
  "inputTokens" INTEGER NOT NULL, "outputTokens" INTEGER NOT NULL, "status" TEXT NOT NULL, "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "TraceSpan_missionId_startedAt_idx" ON "TraceSpan"("missionId", "startedAt");
CREATE INDEX "TraceSpan_sweepId_startedAt_idx" ON "TraceSpan"("sweepId", "startedAt");
