-- Review only (#184): William reviews the new table. No live migration from this task.
CREATE TABLE "waitlist_entries" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "email" VARCHAR(254) NOT NULL,
  "suburb" VARCHAR(80) NOT NULL,
  "suburb_key" VARCHAR(160) NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "waitlist_entries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "waitlist_email_normalized" CHECK ("email" = lower(btrim("email")) AND length("email") > 3),
  CONSTRAINT "waitlist_suburb_present" CHECK (length(btrim("suburb")) > 0 AND length(btrim("suburb_key")) > 0)
);
CREATE UNIQUE INDEX "waitlist_entries_email_suburb_key_key" ON "waitlist_entries"("email", "suburb_key");

-- No public read or write policies: only the existing server database owner can use this table.
ALTER TABLE "waitlist_entries" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "waitlist_entries" FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON "waitlist_entries" FROM anon;
  END IF;
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON "waitlist_entries" FROM authenticated;
  END IF;
END $$;
