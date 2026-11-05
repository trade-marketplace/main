-- Quote point levels the office can tune (#491). Start with 3, +1 per job quoted, 5 to claim.
ALTER TABLE "settings"
  ADD COLUMN "starter_points" INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN "quote_points" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "claim_points" INTEGER NOT NULL DEFAULT 5,
  ADD CONSTRAINT "settings_points_range" CHECK ("starter_points" BETWEEN 0 AND 100 AND "quote_points" BETWEEN 0 AND 100 AND "claim_points" BETWEEN 0 AND 100);
