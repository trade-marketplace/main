-- One reminder for an expired window set; the owned editor clears its mark when the customer updates it.
ALTER TABLE "scheduled_job_marks" DROP CONSTRAINT "scheduled_job_marks_rule_known";
ALTER TABLE "scheduled_job_marks" ADD CONSTRAINT "scheduled_job_marks_rule_known"
  CHECK ("rule" IN ('bounty.expired', 'job.unclaimed', 'price.slow', 'review.reminded', 'job.windows_expired'));
ALTER TABLE "scheduled_job_marks" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "scheduled_job_marks" FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN REVOKE ALL ON "scheduled_job_marks" FROM anon; END IF;
 IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN REVOKE ALL ON "scheduled_job_marks" FROM authenticated; END IF;
END $$;

-- Prisma qualifies model tables for isolated schemas, while raw SQL doesn't inherit the adapter's schema.
-- A lock-only update uses that model reference, then this final BEFORE trigger keeps activity unchanged.
CREATE FUNCTION "preserve_job_windows_lock_timestamp"() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
 IF current_setting('app.job_windows_lock', true) = '1' THEN
   PERFORM set_config('app.job_windows_lock', '', true);
   IF (to_jsonb(NEW) - 'updated_at') = (to_jsonb(OLD) - 'updated_at') THEN
     NEW.updated_at := OLD.updated_at;
   END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "jobs_windows_lock_timestamp" BEFORE UPDATE OF updated_at ON "jobs"
 FOR EACH ROW EXECUTE FUNCTION "preserve_job_windows_lock_timestamp"();
REVOKE ALL ON FUNCTION "preserve_job_windows_lock_timestamp"() FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN REVOKE ALL ON FUNCTION "preserve_job_windows_lock_timestamp"() FROM anon; END IF;
 IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN REVOKE ALL ON FUNCTION "preserve_job_windows_lock_timestamp"() FROM authenticated; END IF;
END $$;
