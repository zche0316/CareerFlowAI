CREATE TABLE "ProfileImport" (
 "id" TEXT NOT NULL, "userId" TEXT NOT NULL, "filename" TEXT NOT NULL, "mime" TEXT NOT NULL,
 "file" BYTEA NOT NULL, "status" TEXT NOT NULL DEFAULT 'EXTRACTED', "pages" JSONB NOT NULL,
 "proposed" JSONB NOT NULL, "events" JSONB NOT NULL, "error" TEXT, "calls" INTEGER NOT NULL DEFAULT 0,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "ProfileImport_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "ProfileImport_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "ProfileImport_userId_createdAt_idx" ON "ProfileImport"("userId", "createdAt");
