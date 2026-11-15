-- Ask Coach: one rolling chat per user (CFS-146).
CREATE TABLE "CoachChat" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "messages" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CoachChat_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CoachChat_userId_key" ON "CoachChat"("userId");
ALTER TABLE "CoachChat" ADD CONSTRAINT "CoachChat_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
