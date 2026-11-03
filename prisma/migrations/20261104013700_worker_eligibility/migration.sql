-- A schema-aware row-lock adapter for privileged server transactions. It grants no eligibility or authority.
-- The job update obtains the job row first; the caller then reads proofs and applies the shared TS policy.
CREATE FUNCTION "lock_worker_eligibility_rows"() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE worker uuid; actor_setting text;
BEGIN
  actor_setting := current_setting('app.eligibility_worker_id', true);
  IF actor_setting IS NULL OR actor_setting = '' THEN RETURN NEW; END IF;
  worker := actor_setting::uuid;
  PERFORM set_config('app.eligibility_worker_id', '', true);
  -- FOR UPDATE also blocks new FK-backed proof/trade rows appearing after the lock snapshot.
  EXECUTE format('SELECT id FROM %I.profiles WHERE id=$1 FOR UPDATE', TG_TABLE_SCHEMA) USING worker;
  -- Exclusive up front: the final assignment trigger also needs FOR UPDATE, so there is no lock upgrade.
  EXECUTE format('SELECT user_id FROM %I.worker_profiles WHERE user_id=$1 FOR UPDATE', TG_TABLE_SCHEMA) USING worker;
  EXECUTE format('SELECT user_id FROM %I.worker_trades WHERE user_id=$1 AND trade=$2 FOR SHARE', TG_TABLE_SCHEMA) USING worker, NEW.category;
  EXECUTE format('SELECT id FROM %I.licences WHERE user_id=$1 AND trade=$2 FOR SHARE', TG_TABLE_SCHEMA) USING worker, NEW.category;
  EXECUTE format('SELECT id FROM %I.settings WHERE id=1 FOR SHARE', TG_TABLE_SCHEMA);
  RETURN NEW;
END $$;
CREATE TRIGGER "jobs_lock_worker_eligibility" BEFORE UPDATE OF updated_at ON "jobs"
  FOR EACH ROW EXECUTE FUNCTION "lock_worker_eligibility_rows"();

-- Defence in depth for every estimate writer, including direct privileged writes and reassignment of estimates.
CREATE FUNCTION "deny_own_job_estimate"() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE owner_id uuid;
BEGIN
  EXECUTE format('SELECT customer_id FROM %I.jobs WHERE id=$1 FOR SHARE', TG_TABLE_SCHEMA) INTO owner_id USING NEW.job_id;
  IF owner_id = NEW.worker_id THEN RAISE EXCEPTION 'Cannot estimate your own job' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "estimates_deny_own_job" BEFORE INSERT OR UPDATE OF job_id,worker_id,minutes,materials_cents,note,needs_site_visit ON "estimates"
  FOR EACH ROW EXECUTE FUNCTION "deny_own_job_estimate"();

ALTER TABLE "jobs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "estimates" ENABLE ROW LEVEL SECURITY;
REVOKE INSERT,UPDATE,DELETE ON "jobs","estimates" FROM PUBLIC;
REVOKE ALL ON FUNCTION "lock_worker_eligibility_rows"(),"deny_own_job_estimate"() FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname='anon') THEN
    REVOKE INSERT,UPDATE,DELETE ON "jobs","estimates" FROM anon;
    REVOKE ALL ON FUNCTION "lock_worker_eligibility_rows"(),"deny_own_job_estimate"() FROM anon;
  END IF;
  IF EXISTS (SELECT FROM pg_roles WHERE rolname='authenticated') THEN
    REVOKE INSERT,UPDATE,DELETE ON "jobs","estimates" FROM authenticated;
    REVOKE ALL ON FUNCTION "lock_worker_eligibility_rows"(),"deny_own_job_estimate"() FROM authenticated;
  END IF;
END $$;
