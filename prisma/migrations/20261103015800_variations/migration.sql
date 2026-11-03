ALTER TABLE "variations" ADD COLUMN "request_key" uuid, ADD COLUMN "revision" integer NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX "variations_request_key_key" ON "variations"("request_key");
ALTER TABLE "variations" ADD CONSTRAINT "variation_revision_nonnegative" CHECK ("revision" >= 0);
ALTER TABLE "payments" ADD COLUMN "variation_revision" integer;
UPDATE "payments" SET "variation_revision" = 0 WHERE "kind" = 'VARIATION';
ALTER TABLE "payments" ADD CONSTRAINT "payment_variation_revision" CHECK ("variation_revision" IS NULL OR ("kind" = 'VARIATION' AND "variation_revision" >= 0));

CREATE TABLE "variation_photos" (
  "path" text PRIMARY KEY, "job_id" uuid NOT NULL, "uploaded_by_id" uuid NOT NULL, "request_key" uuid NOT NULL,
  "variation_id" uuid REFERENCES "variations"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "position" integer NOT NULL DEFAULT 0 CHECK ("position" >= 0),
  "ready" boolean NOT NULL DEFAULT false, "deleting" boolean NOT NULL DEFAULT false,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "variation_photos_variation_id_position_idx" ON "variation_photos"("variation_id", "position");
CREATE INDEX "variation_photos_created_at_idx" ON "variation_photos"("created_at");
ALTER TABLE "variation_photos" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "variations" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "variation_photos", "variations" FROM PUBLIC;
DO $roles$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN REVOKE ALL ON "variation_photos", "variations" FROM anon; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN REVOKE ALL ON "variation_photos", "variations" FROM authenticated; END IF;
END $roles$;

-- Commands lock the parent first. The final check also runs for privileged server SQL writes, while legacy
-- records retain the existing migration's flow rules. Request/revision cannot be moved or rewritten.
CREATE FUNCTION "variation_command_rules"() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $fn$
DECLARE job_status text; job_worker uuid; paid boolean;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.request_key IS DISTINCT FROM NEW.request_key THEN
    RAISE EXCEPTION 'variation request identity is immutable' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.request_key IS NULL THEN RETURN NEW; END IF;
  EXECUTE format('SELECT status::text, worker_id FROM %I.jobs WHERE id = $1 FOR UPDATE', TG_TABLE_SCHEMA) INTO job_status, job_worker USING NEW.job_id;
  IF job_status IS DISTINCT FROM 'ASSIGNED' THEN
    RAISE EXCEPTION 'extra work requires an in-progress job' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'INSERT' AND (job_worker IS DISTINCT FROM NEW.requested_by_id OR NEW.revision <> 0) THEN
    RAISE EXCEPTION 'only the assigned lead can request extra work' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.revision IS DISTINCT FROM OLD.revision
    AND (NEW.status <> 'PRICED' OR OLD.status NOT IN ('REQUESTED', 'PRICED') OR NEW.revision <> OLD.revision + 1) THEN
    RAISE EXCEPTION 'variation revision must advance with a price' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.status = 'APPROVED' AND OLD.status <> 'APPROVED' THEN
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I.payments WHERE variation_id = $1 AND kind = ''VARIATION'' AND status = ''PAID'' AND amount_cents = $2 AND variation_revision = $3)', TG_TABLE_SCHEMA)
      INTO paid USING NEW.id, NEW.price_cents, NEW.revision;
    IF NOT paid THEN RAISE EXCEPTION 'extra work requires verified payment' USING ERRCODE = 'check_violation'; END IF;
  END IF;
  RETURN NEW;
END $fn$;
CREATE TRIGGER "variations_command_rules" BEFORE INSERT OR UPDATE ON "variations" FOR EACH ROW EXECUTE FUNCTION "variation_command_rules"();
REVOKE ALL ON FUNCTION "variation_command_rules"() FROM PUBLIC;

-- The job row is locked before this trigger runs. A concurrent variation request either commits before this
-- check, or waits and observes SUBMITTED; it cannot slip between the status machine's facts and status write.
CREATE FUNCTION "job_no_open_variations_on_submit"() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $fn$
DECLARE pending boolean;
BEGIN
  IF OLD.status = 'ASSIGNED' AND NEW.status = 'SUBMITTED' THEN
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I.variations WHERE job_id = $1 AND status IN (''REQUESTED'', ''PRICED''))', TG_TABLE_SCHEMA) INTO pending USING NEW.id;
    IF pending THEN RAISE EXCEPTION 'decide open extra work before submitting' USING ERRCODE = 'check_violation'; END IF;
  END IF;
  RETURN NEW;
END $fn$;
CREATE TRIGGER "jobs_no_open_variations_on_submit" BEFORE UPDATE ON "jobs" FOR EACH ROW EXECUTE FUNCTION "job_no_open_variations_on_submit"();
REVOKE ALL ON FUNCTION "job_no_open_variations_on_submit"() FROM PUBLIC;
