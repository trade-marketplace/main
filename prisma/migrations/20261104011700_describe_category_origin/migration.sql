-- Preserve the customer's explicit category choice separately from #116's canonical job fields.
ALTER TABLE "job_drafts" ADD COLUMN "manual_category" boolean;
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
