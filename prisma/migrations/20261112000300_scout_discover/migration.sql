-- Scout starts resume teams only when the user opts in; by default it puts roles on the board.
ALTER TABLE "ScoutSetting" ADD COLUMN "autoPackage" BOOLEAN NOT NULL DEFAULT false;
