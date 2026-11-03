-- Shared problem threads are an explicit scope. Never expose or combine existing one-person office histories.
ALTER TABLE "support_threads" ADD COLUMN "job_participants" boolean NOT NULL DEFAULT false;
ALTER TABLE "support_threads" ADD CONSTRAINT "shared_support_requires_job" CHECK (NOT "job_participants" OR "job_id" IS NOT NULL);
CREATE UNIQUE INDEX "one_open_shared_problem_thread_per_job" ON "support_threads" ("job_id") WHERE "job_participants" AND "status" = 'OPEN';
ALTER TABLE "support_messages" ADD COLUMN "request_key" uuid;
CREATE UNIQUE INDEX "support_messages_request_key_key" ON "support_messages" ("request_key");
CREATE TABLE "support_message_photos" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "message_id" uuid NOT NULL REFERENCES "support_messages"("id") ON DELETE CASCADE,
  "path" text NOT NULL,
  "position" integer NOT NULL DEFAULT 0,
  UNIQUE ("message_id", "path")
);
CREATE TABLE "support_thread_reads" (
  "thread_id" uuid NOT NULL REFERENCES "support_threads"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "profiles"("id") ON DELETE CASCADE,
  "read_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("thread_id", "user_id")
);
ALTER TABLE "support_message_photos" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "support_thread_reads" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "support_threads" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "support_messages" ENABLE ROW LEVEL SECURITY;
-- All public reads go through the server, which redacts contact details before a job has a worker.
REVOKE ALL ON "support_threads", "support_messages", "support_message_photos", "support_thread_reads" FROM PUBLIC;
DO $roles$ BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON "support_threads", "support_messages", "support_message_photos", "support_thread_reads" FROM anon;
  END IF;
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON "support_threads", "support_messages", "support_message_photos", "support_thread_reads" FROM authenticated;
  END IF;
END $roles$;

CREATE FUNCTION "support_scope_immutable"() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $fn$
BEGIN
  IF NEW.job_participants IS DISTINCT FROM OLD.job_participants THEN
    RAISE EXCEPTION 'legacy support histories cannot become shared' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $fn$;
CREATE TRIGGER "support_scope_immutable" BEFORE UPDATE ON "support_threads"
  FOR EACH ROW EXECUTE FUNCTION "support_scope_immutable"();

-- Legacy private support keeps its existing SET NULL history. Shared threads cannot outlive their job.
CREATE FUNCTION "delete_shared_job_threads"() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $fn$
BEGIN
  EXECUTE format('DELETE FROM %I.support_threads WHERE job_id=$1 AND job_participants', TG_TABLE_SCHEMA) USING OLD.id;
  RETURN OLD;
END $fn$;
CREATE TRIGGER "delete_shared_job_threads" BEFORE DELETE ON "jobs"
  FOR EACH ROW EXECUTE FUNCTION "delete_shared_job_threads"();

CREATE OR REPLACE FUNCTION "support_message_rules"() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $fn$
DECLARE thread_user uuid; author_role text; shared boolean; customer uuid; worker uuid;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF (NEW.thread_id, NEW.from_office, NEW.internal, NEW.body, NEW.created_at, NEW.request_key)
       IS DISTINCT FROM (OLD.thread_id, OLD.from_office, OLD.internal, OLD.body, OLD.created_at, OLD.request_key)
       OR (NEW.author_id IS DISTINCT FROM OLD.author_id AND NEW.author_id IS NOT NULL) THEN
      RAISE EXCEPTION 'support messages can''t be edited' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  EXECUTE format('SELECT t.user_id, t.job_participants, j.customer_id, j.worker_id FROM %I.support_threads t LEFT JOIN %I.jobs j ON j.id=t.job_id WHERE t.id=$1', TG_TABLE_SCHEMA, TG_TABLE_SCHEMA)
    INTO thread_user, shared, customer, worker USING NEW.thread_id;
  EXECUTE format('SELECT role::text FROM %I.profiles WHERE id=$1', TG_TABLE_SCHEMA) INTO author_role USING NEW.author_id;
  IF NEW.author_id IS NULL OR (author_role IS DISTINCT FROM 'ADMIN' AND
      ((shared AND NEW.author_id IS DISTINCT FROM customer AND NEW.author_id IS DISTINCT FROM worker)
       OR (NOT shared AND NEW.author_id IS DISTINCT FROM thread_user))) THEN
    IF shared THEN
      RAISE EXCEPTION 'support messages require a current participant or the office' USING ERRCODE = 'check_violation';
    ELSE
      RAISE EXCEPTION 'a support message is from the thread''s person or the office' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  NEW.from_office := author_role = 'ADMIN' AND (shared OR NEW.author_id IS DISTINCT FROM thread_user);
  RETURN NEW;
END $fn$;

DROP POLICY "Read own support threads" ON "support_threads";
CREATE POLICY "Read own support threads" ON "support_threads" FOR SELECT USING (
  (NOT "job_participants" AND "user_id" = (SELECT auth.uid())) OR
  ("job_participants" AND EXISTS (SELECT 1 FROM "jobs" j WHERE j.id="job_id" AND (j.customer_id=(SELECT auth.uid()) OR j.worker_id=(SELECT auth.uid()))))
);
DROP POLICY "Read own support messages, not office notes" ON "support_messages";
CREATE POLICY "Read own support messages, not office notes" ON "support_messages" FOR SELECT USING (
  NOT "internal" AND EXISTS (SELECT 1 FROM "support_threads" t WHERE t.id="thread_id")
);
