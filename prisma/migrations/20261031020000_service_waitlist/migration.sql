-- Review only (#245): William reviews the new table. No live migration from this task.
CREATE TABLE "service_waitlist_entries" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "email" VARCHAR(254) NOT NULL,
  "suburb" VARCHAR(80) NOT NULL,
  "suburb_key" VARCHAR(160) NOT NULL,
  "trade" "trade" NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "service_waitlist_entries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "service_waitlist_email_normalized" CHECK ("email" = lower(btrim("email")) AND length("email") > 3),
  CONSTRAINT "service_waitlist_suburb_present" CHECK (length(btrim("suburb")) > 0 AND length(btrim("suburb_key")) > 0)
);
CREATE UNIQUE INDEX "service_waitlist_entries_email_suburb_key_trade_key" ON "service_waitlist_entries"("email", "suburb_key", "trade");
ALTER TABLE "service_waitlist_entries" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "service_waitlist_entries" FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON "service_waitlist_entries" FROM anon;
  END IF;
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON "service_waitlist_entries" FROM authenticated;
  END IF;
END $$;
