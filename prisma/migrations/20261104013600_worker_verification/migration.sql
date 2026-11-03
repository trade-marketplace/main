ALTER TABLE "profiles"
  ADD COLUMN "phone_verified_at" timestamptz,
  ADD COLUMN "phone_verified_for" text,
  ADD CONSTRAINT "phone_verification_is_bound" CHECK (
    (phone_verified_at IS NULL AND phone_verified_for IS NULL) OR
    (phone_verified_at IS NOT NULL AND phone_verified_for IS NOT NULL AND phone IS NOT NULL AND phone_verified_for = phone AND phone_verified_for ~ '^\+642[0-9]{7,9}$')
  );
ALTER TABLE "worker_profiles"
  ADD COLUMN "identity_checked_at" timestamptz,
  ADD COLUMN "identity_checked_by_id" uuid REFERENCES "profiles"(id) ON DELETE SET NULL,
  ADD COLUMN "paused_at" timestamptz,
  ADD COLUMN "paused_by_id" uuid REFERENCES "profiles"(id) ON DELETE SET NULL,
  ADD CONSTRAINT "identity_check_has_time" CHECK (identity_checked_by_id IS NULL OR identity_checked_at IS NOT NULL),
  ADD CONSTRAINT "worker_pause_has_time" CHECK (paused_by_id IS NULL OR paused_at IS NOT NULL);
-- No legacy verification backfill: a generic office check does not prove an identity/phone check.

CREATE FUNCTION "invalidate_worker_phone_proof"() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.phone IS DISTINCT FROM OLD.phone THEN
    NEW.phone_verified_at := NULL;
    NEW.phone_verified_for := NULL;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "profiles_invalidate_phone_proof" BEFORE UPDATE OF phone ON "profiles"
  FOR EACH ROW EXECUTE FUNCTION "invalidate_worker_phone_proof"();

-- Lock the worker row while assigning, serializing a claim against an office pause. Assigned work can finish.
CREATE FUNCTION "deny_paused_worker_assignment"() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE paused timestamptz;
BEGIN
  IF NEW.worker_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.worker_id IS DISTINCT FROM OLD.worker_id) THEN
    EXECUTE format('SELECT paused_at FROM %I.worker_profiles WHERE user_id = $1 FOR UPDATE', TG_TABLE_SCHEMA)
      INTO paused USING NEW.worker_id;
    IF paused IS NOT NULL THEN RAISE EXCEPTION 'Worker is paused' USING ERRCODE = '23514'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "jobs_deny_paused_worker" BEFORE INSERT OR UPDATE OF worker_id ON "jobs"
  FOR EACH ROW EXECUTE FUNCTION "deny_paused_worker_assignment"();

ALTER TABLE "profiles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "worker_profiles" ENABLE ROW LEVEL SECURITY;
-- Preserve existing own-row reads. Every profile/worker mutation already goes through the privileged server.
REVOKE INSERT, UPDATE, DELETE ON "profiles", "worker_profiles" FROM PUBLIC;
REVOKE ALL ON FUNCTION "invalidate_worker_phone_proof"(), "deny_paused_worker_assignment"() FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE INSERT, UPDATE, DELETE ON "profiles", "worker_profiles" FROM anon;
    REVOKE ALL ON FUNCTION "invalidate_worker_phone_proof"(), "deny_paused_worker_assignment"() FROM anon;
  END IF;
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE INSERT, UPDATE, DELETE ON "profiles", "worker_profiles" FROM authenticated;
    REVOKE ALL ON FUNCTION "invalidate_worker_phone_proof"(), "deny_paused_worker_assignment"() FROM authenticated;
  END IF;
END $$;
