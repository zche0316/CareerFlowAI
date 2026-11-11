-- Which provider mode a role belongs to, so demo roles and live roles keep separate boards.
-- Filled from the role's runs or its source at startup (apps/api/src/role-library.ts).
ALTER TABLE "Application" ADD COLUMN "mode" TEXT;
