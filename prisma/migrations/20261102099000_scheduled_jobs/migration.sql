-- Scheduled jobs runner (#99). The marks table, then the every-minute pg_cron job that calls the protected
-- /api/scheduler/run route. Works on plain Postgres (CI, local tests): the cron job is only scheduled when pg_cron
-- and pg_net exist, and the function does nothing until its two Vault secrets are set (docs/server/scheduler.md).

CREATE TABLE "scheduled_job_marks" (
 "rule" TEXT NOT NULL,
 "job_id" UUID NOT NULL,
 "marked_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "scheduled_job_marks_pkey" PRIMARY KEY ("rule", "job_id"),
 CONSTRAINT "scheduled_job_marks_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "scheduled_job_marks_rule_known" CHECK ("rule" IN ('bounty.expired', 'job.unclaimed', 'price.slow', 'review.reminded'))
);
CREATE INDEX "scheduled_job_marks_job_id_idx" ON "scheduled_job_marks" ("job_id");

ALTER TABLE "scheduled_job_marks" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "scheduled_job_marks" FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN REVOKE ALL ON "scheduled_job_marks" FROM anon; END IF;
 IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN REVOKE ALL ON "scheduled_job_marks" FROM authenticated; END IF;
END $$;

-- Asks the app to run the rules. The route URL and shared secret live in Supabase Vault (names
-- scheduler_url, scheduler_secret), never in a migration. Returns quietly when pg_net or either secret is missing,
-- so a half-set-up project just doesn't run the timers instead of filling the cron log with errors.
CREATE FUNCTION "run_scheduled_jobs"() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $fn$
DECLARE
 target_url text;
 secret text;
BEGIN
 IF to_regclass('vault.decrypted_secrets') IS NULL OR to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') IS NULL THEN
  RETURN;
 END IF;
 EXECUTE 'SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = ''scheduler_url'' LIMIT 1' INTO target_url;
 EXECUTE 'SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = ''scheduler_secret'' LIMIT 1' INTO secret;
 IF coalesce(target_url, '') = '' OR coalesce(secret, '') = '' THEN
  RETURN;
 END IF;
 EXECUTE 'SELECT net.http_post(url := $1, headers := jsonb_build_object(''Authorization'', ''Bearer '' || $2, ''Content-Type'', ''application/json''), body := ''{}''::jsonb, timeout_milliseconds := 55000)'
  USING target_url, secret;
END
$fn$;
REVOKE ALL ON FUNCTION "run_scheduled_jobs"() FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN REVOKE ALL ON FUNCTION "run_scheduled_jobs"() FROM anon; END IF;
 IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN REVOKE ALL ON FUNCTION "run_scheduled_jobs"() FROM authenticated; END IF;
END $$;

-- Every minute, when pg_cron and pg_net are available. cron.schedule with a name replaces the same-named job,
-- so running this twice leaves one.
DO $$ BEGIN
 IF EXISTS (SELECT FROM pg_available_extensions WHERE name = 'pg_cron')
    AND EXISTS (SELECT FROM pg_available_extensions WHERE name = 'pg_net') THEN
  CREATE EXTENSION IF NOT EXISTS pg_cron;
  CREATE EXTENSION IF NOT EXISTS pg_net;
  PERFORM cron.schedule('run-scheduled-jobs', '* * * * *', 'SELECT public.run_scheduled_jobs()');
 END IF;
END $$;
