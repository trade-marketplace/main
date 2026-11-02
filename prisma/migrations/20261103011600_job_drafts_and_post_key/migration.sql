-- Server-only drafts and an idempotency key for posting (#116).
CREATE TABLE "job_drafts" (
  "profile_id" uuid PRIMARY KEY REFERENCES "profiles"("id") ON DELETE CASCADE,
  "data" jsonb NOT NULL,
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER "job_drafts_set_updated_at" BEFORE UPDATE ON "job_drafts"
  FOR EACH ROW EXECUTE FUNCTION "set_updated_at"();
ALTER TABLE "job_drafts" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "job_drafts" FROM PUBLIC;
DO $roles$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON "job_drafts" FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON "job_drafts" FROM authenticated;
  END IF;
END
$roles$;
ALTER TABLE "jobs" ADD COLUMN "post_key" uuid;
ALTER TABLE "jobs" ADD COLUMN "photos_need_check" boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX "jobs_post_key_key" ON "jobs"("post_key");
