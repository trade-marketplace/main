-- CreateEnum
CREATE TYPE "evidence_check" AS ENUM ('APPROVED', 'FLAGGED');

-- CreateEnum
CREATE TYPE "problem_status" AS ENUM ('OPEN', 'RESOLVED');

-- CreateEnum
CREATE TYPE "support_thread_status" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "notification_channel" AS ENUM ('EMAIL', 'PUSH');

-- CreateTable
CREATE TABLE "trade_evidence_rules" (
    "trade" "trade" NOT NULL,
    "coc_required" BOOLEAN NOT NULL DEFAULT false,
    "coc_file_required" BOOLEAN NOT NULL DEFAULT false,
    "min_photos" INTEGER NOT NULL DEFAULT 0,
    "notes_required" BOOLEAN NOT NULL DEFAULT false,
    "updated_by_id" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trade_evidence_rules_pkey" PRIMARY KEY ("trade")
);

-- CreateTable
CREATE TABLE "completion_evidence" (
    "job_id" UUID NOT NULL,
    "worker_id" UUID NOT NULL,
    "coc_number" TEXT,
    "coc_path" TEXT,
    "notes" TEXT,
    "declaration" TEXT,
    "declared_at" TIMESTAMPTZ,
    "submitted_at" TIMESTAMPTZ,
    "office_check" "evidence_check",
    "check_note" TEXT,
    "checked_by_id" UUID,
    "checked_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "completion_evidence_pkey" PRIMARY KEY ("job_id")
);

-- CreateTable
CREATE TABLE "completion_evidence_photos" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "job_id" UUID NOT NULL,
    "path" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "completion_evidence_photos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reviews" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "job_id" UUID NOT NULL,
    "reviewer_id" UUID NOT NULL,
    "worker_id" UUID NOT NULL,
    "rating" INTEGER NOT NULL,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "comment" TEXT,
    "editable_until" TIMESTAMPTZ NOT NULL DEFAULT (now() + '7 days'::interval),
    "reported_at" TIMESTAMPTZ,
    "reported_by_id" UUID,
    "report_reason" TEXT,
    "hidden_at" TIMESTAMPTZ,
    "hidden_reason" TEXT,
    "hidden_by_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "read_at" TIMESTAMPTZ,
    "channels_sent" "notification_channel"[] DEFAULT ARRAY[]::"notification_channel"[],
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "problem_reports" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "job_id" UUID NOT NULL,
    "reported_by_id" UUID NOT NULL,
    "topic" TEXT NOT NULL,
    "details" TEXT NOT NULL,
    "status" "problem_status" NOT NULL DEFAULT 'OPEN',
    "resolution" TEXT,
    "resolved_by_id" UUID,
    "resolved_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "problem_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "problem_report_photos" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "report_id" UUID NOT NULL,
    "path" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "problem_report_photos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_threads" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "subject" TEXT NOT NULL,
    "job_id" UUID,
    "problem_report_id" UUID,
    "status" "support_thread_status" NOT NULL DEFAULT 'OPEN',
    "closed_at" TIMESTAMPTZ,
    "last_message_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_threads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_messages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "thread_id" UUID NOT NULL,
    "author_id" UUID,
    "from_office" BOOLEAN NOT NULL DEFAULT false,
    "internal" BOOLEAN NOT NULL DEFAULT false,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "actor_id" UUID,
    "actor_role" "role",
    "action" TEXT NOT NULL,
    "record_type" TEXT NOT NULL,
    "record_id" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "reason" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "completion_evidence_office_check_submitted_at_idx" ON "completion_evidence"("office_check", "submitted_at");

-- CreateIndex
CREATE INDEX "completion_evidence_worker_id_created_at_idx" ON "completion_evidence"("worker_id", "created_at");

-- CreateIndex
CREATE INDEX "completion_evidence_photos_job_id_position_idx" ON "completion_evidence_photos"("job_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "reviews_job_id_key" ON "reviews"("job_id");

-- CreateIndex
CREATE INDEX "reviews_worker_id_created_at_idx" ON "reviews"("worker_id", "created_at");

-- CreateIndex
CREATE INDEX "notifications_user_id_created_at_idx" ON "notifications"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "problem_reports_job_id_created_at_idx" ON "problem_reports"("job_id", "created_at");

-- CreateIndex
CREATE INDEX "problem_reports_status_created_at_idx" ON "problem_reports"("status", "created_at");

-- CreateIndex
CREATE INDEX "problem_report_photos_report_id_position_idx" ON "problem_report_photos"("report_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "support_threads_problem_report_id_key" ON "support_threads"("problem_report_id");

-- CreateIndex
CREATE INDEX "support_threads_user_id_last_message_at_idx" ON "support_threads"("user_id", "last_message_at");

-- CreateIndex
CREATE INDEX "support_threads_status_last_message_at_idx" ON "support_threads"("status", "last_message_at");

-- CreateIndex
CREATE INDEX "support_messages_thread_id_created_at_idx" ON "support_messages"("thread_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_log_record_type_record_id_created_at_idx" ON "audit_log"("record_type", "record_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_log_actor_id_created_at_idx" ON "audit_log"("actor_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_log_created_at_idx" ON "audit_log"("created_at");

-- AddForeignKey
ALTER TABLE "trade_evidence_rules" ADD CONSTRAINT "trade_evidence_rules_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "completion_evidence" ADD CONSTRAINT "completion_evidence_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "completion_evidence" ADD CONSTRAINT "completion_evidence_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "completion_evidence" ADD CONSTRAINT "completion_evidence_checked_by_id_fkey" FOREIGN KEY ("checked_by_id") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "completion_evidence_photos" ADD CONSTRAINT "completion_evidence_photos_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "completion_evidence"("job_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_reported_by_id_fkey" FOREIGN KEY ("reported_by_id") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_hidden_by_id_fkey" FOREIGN KEY ("hidden_by_id") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "problem_reports" ADD CONSTRAINT "problem_reports_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "problem_reports" ADD CONSTRAINT "problem_reports_reported_by_id_fkey" FOREIGN KEY ("reported_by_id") REFERENCES "profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "problem_reports" ADD CONSTRAINT "problem_reports_resolved_by_id_fkey" FOREIGN KEY ("resolved_by_id") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "problem_report_photos" ADD CONSTRAINT "problem_report_photos_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "problem_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_threads" ADD CONSTRAINT "support_threads_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_threads" ADD CONSTRAINT "support_threads_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_threads" ADD CONSTRAINT "support_threads_problem_report_id_fkey" FOREIGN KEY ("problem_report_id") REFERENCES "problem_reports"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "support_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================================================================
-- Hand-written below this line: things schema.prisma can't express. Keep it in sync with the comments there.
-- ============================================================================================================

-- updated_at changes on every update, including ones made outside Prisma -------------------------------------
-- (set_updated_at() comes from Schema 1.)
CREATE TRIGGER "trade_evidence_rules_set_updated_at" BEFORE UPDATE ON "trade_evidence_rules"
  FOR EACH ROW EXECUTE FUNCTION "set_updated_at"();
CREATE TRIGGER "completion_evidence_set_updated_at" BEFORE UPDATE ON "completion_evidence"
  FOR EACH ROW EXECUTE FUNCTION "set_updated_at"();
CREATE TRIGGER "reviews_set_updated_at" BEFORE UPDATE ON "reviews"
  FOR EACH ROW EXECUTE FUNCTION "set_updated_at"();
CREATE TRIGGER "problem_reports_set_updated_at" BEFORE UPDATE ON "problem_reports"
  FOR EACH ROW EXECUTE FUNCTION "set_updated_at"();
CREATE TRIGGER "support_threads_set_updated_at" BEFORE UPDATE ON "support_threads"
  FOR EACH ROW EXECUTE FUNCTION "set_updated_at"();

-- Evidence rules per trade -----------------------------------------------------------------------------------
-- One row per trade, made here (WEBAPP_SPEC D11): electrical needs a CoC number and its PDF or photo; the other
-- trades need at least one photo and notes. The office changes them in Settings (F14). A file needs a number.
ALTER TABLE "trade_evidence_rules"
  ADD CONSTRAINT "trade_evidence_rules_min_photos" CHECK ("min_photos" BETWEEN 0 AND 20),
  ADD CONSTRAINT "trade_evidence_rules_coc_file_needs_coc" CHECK (NOT "coc_file_required" OR "coc_required");

INSERT INTO "trade_evidence_rules" ("trade", "coc_required", "coc_file_required", "min_photos", "notes_required") VALUES
  ('ELECTRICAL', true, true, 0, false),
  ('PLUMBING', false, false, 1, true),
  ('GAS', false, false, 1, true),
  ('CONSTRUCTION', false, false, 1, true),
  ('OTHER', false, false, 1, true);

-- Completion evidence ----------------------------------------------------------------------------------------
-- The declaration's words and its tick go together. The office checks sent evidence only (a FLAGGED check stays
-- on the draft it sends back, so the worker sees the note), records when, and a flag says what's wrong.
ALTER TABLE "completion_evidence"
  ADD CONSTRAINT "completion_evidence_coc_number_present" CHECK ("coc_number" IS NULL OR btrim("coc_number") <> ''),
  ADD CONSTRAINT "completion_evidence_coc_path_present" CHECK ("coc_path" IS NULL OR btrim("coc_path") <> ''),
  ADD CONSTRAINT "completion_evidence_declaration_pair"
    CHECK (("declaration" IS NULL) = ("declared_at" IS NULL) AND ("declaration" IS NULL OR btrim("declaration") <> '')),
  ADD CONSTRAINT "completion_evidence_approved_when_sent" CHECK ("office_check" IS DISTINCT FROM 'APPROVED' OR "submitted_at" IS NOT NULL),
  ADD CONSTRAINT "completion_evidence_check_has_checked_at" CHECK (("office_check" IS NULL) = ("checked_at" IS NULL)),
  ADD CONSTRAINT "completion_evidence_flag_has_note"
    CHECK ("office_check" IS DISTINCT FROM 'FLAGGED' OR btrim(coalesce("check_note", '')) <> '');

ALTER TABLE "completion_evidence_photos"
  ADD CONSTRAINT "completion_evidence_photos_path_present" CHECK (btrim("path") <> '');

-- Evidence is the job's worker's, on a claimed job. Sending it (setting submitted_at) checks the trade's rules,
-- the declaration and that materials spend is reported, and the database stamps the time. Once sent the content
-- is frozen; only a FLAGGED check lets it go back to a draft, and sending again clears the check.
CREATE FUNCTION "completion_evidence_rules"() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $fn$
DECLARE
  job_status text;
  job_trade text;
  job_worker uuid;
  rule record;
  photo_count int;
  spent int;
  sending boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.submitted_at IS NOT NULL THEN
      RAISE EXCEPTION 'evidence was sent: it''s kept' USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.job_id IS DISTINCT FROM OLD.job_id THEN
    RAISE EXCEPTION 'evidence can''t move to another job' USING ERRCODE = 'check_violation';
  END IF;

  EXECUTE format('SELECT status::text, category::text, worker_id FROM %I.jobs WHERE id = $1', TG_TABLE_SCHEMA)
    INTO job_status, job_trade, job_worker USING NEW.job_id;
  IF (TG_OP = 'INSERT' OR NEW.worker_id IS DISTINCT FROM OLD.worker_id) AND NEW.worker_id IS DISTINCT FROM job_worker THEN
    RAISE EXCEPTION 'only the job''s worker sends its evidence' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'INSERT' AND job_status NOT IN ('ASSIGNED', 'SUBMITTED') THEN
    RAISE EXCEPTION 'job is %: evidence is for a claimed job', job_status USING ERRCODE = 'check_violation';
  END IF;

  sending := NEW.submitted_at IS NOT NULL AND (TG_OP = 'INSERT' OR OLD.submitted_at IS NULL);

  IF NEW.office_check IS NOT NULL AND NEW.submitted_at IS NULL
     AND (TG_OP = 'INSERT' OR NEW.office_check IS DISTINCT FROM OLD.office_check) THEN
    RAISE EXCEPTION 'evidence is checked once it''s sent' USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.submitted_at IS NOT NULL THEN
    IF NEW.submitted_at IS NULL THEN
      IF OLD.office_check IS DISTINCT FROM 'FLAGGED' THEN
        RAISE EXCEPTION 'evidence was sent: it goes back to a draft only when the office flags it'
          USING ERRCODE = 'check_violation';
      END IF;
    ELSE
      IF (OLD.worker_id, OLD.coc_number, OLD.coc_path, OLD.notes, OLD.declaration, OLD.declared_at)
         IS DISTINCT FROM (NEW.worker_id, NEW.coc_number, NEW.coc_path, NEW.notes, NEW.declaration, NEW.declared_at) THEN
        RAISE EXCEPTION 'evidence was sent: it can''t change' USING ERRCODE = 'check_violation';
      END IF;
      NEW.submitted_at := OLD.submitted_at;
    END IF;
  END IF;

  IF sending THEN
    IF job_status NOT IN ('ASSIGNED', 'SUBMITTED') THEN
      RAISE EXCEPTION 'job is %: evidence can''t be sent', job_status USING ERRCODE = 'check_violation';
    END IF;
    EXECUTE format('SELECT * FROM %I.trade_evidence_rules WHERE trade::text = $1', TG_TABLE_SCHEMA)
      INTO rule USING job_trade;
    IF rule IS NULL THEN
      RAISE EXCEPTION '% isn''t configured: its evidence rules are missing', job_trade USING ERRCODE = 'check_violation';
    END IF;
    IF rule.coc_required AND NEW.coc_number IS NULL THEN
      RAISE EXCEPTION '% evidence needs a CoC number', job_trade USING ERRCODE = 'check_violation';
    END IF;
    IF rule.coc_file_required AND NEW.coc_path IS NULL THEN
      RAISE EXCEPTION '% evidence needs the CoC file', job_trade USING ERRCODE = 'check_violation';
    END IF;
    IF rule.notes_required AND btrim(coalesce(NEW.notes, '')) = '' THEN
      RAISE EXCEPTION '% evidence needs notes', job_trade USING ERRCODE = 'check_violation';
    END IF;
    EXECUTE format('SELECT count(*) FROM %I.completion_evidence_photos WHERE job_id = $1', TG_TABLE_SCHEMA)
      INTO photo_count USING NEW.job_id;
    IF photo_count < rule.min_photos THEN
      RAISE EXCEPTION '% evidence needs at least % photo(s), it has %', job_trade, rule.min_photos, photo_count
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.declared_at IS NULL THEN
      RAISE EXCEPTION 'evidence needs the declaration ticked' USING ERRCODE = 'check_violation';
    END IF;
    EXECUTE format('SELECT spent_cents FROM %I.job_materials WHERE job_id = $1', TG_TABLE_SCHEMA)
      INTO spent USING NEW.job_id;
    IF spent IS NULL THEN
      RAISE EXCEPTION 'evidence needs the materials spend reported (job_materials.spent_cents, 0 if none)'
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.submitted_at := now();
    NEW.office_check := NULL;
    NEW.check_note := NULL;
    NEW.checked_by_id := NULL;
    NEW.checked_at := NULL;
  END IF;
  RETURN NEW;
END
$fn$;

CREATE TRIGGER "completion_evidence_rules" BEFORE INSERT OR UPDATE OR DELETE ON "completion_evidence"
  FOR EACH ROW EXECUTE FUNCTION "completion_evidence_rules"();

-- Photos can't be added, changed or removed once the evidence is sent.
CREATE FUNCTION "completion_evidence_photo_rules"() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $fn$
DECLARE
  sent timestamptz;
BEGIN
  EXECUTE format('SELECT submitted_at FROM %I.completion_evidence WHERE job_id = ANY($1)', TG_TABLE_SCHEMA)
    INTO sent USING ARRAY[CASE WHEN TG_OP = 'DELETE' THEN OLD.job_id ELSE NEW.job_id END,
                          CASE WHEN TG_OP = 'UPDATE' THEN OLD.job_id END];
  IF sent IS NOT NULL THEN
    RAISE EXCEPTION 'evidence was sent: its photos can''t change' USING ERRCODE = 'check_violation';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END
$fn$;

CREATE TRIGGER "completion_evidence_photos_rules" BEFORE INSERT OR UPDATE OR DELETE ON "completion_evidence_photos"
  FOR EACH ROW EXECUTE FUNCTION "completion_evidence_photo_rules"();

-- Reviews ----------------------------------------------------------------------------------------------------
-- 1–5 stars. Hiding needs a reason, and so does a report; each comes with its time.
ALTER TABLE "reviews"
  ADD CONSTRAINT "reviews_rating_1_to_5" CHECK ("rating" BETWEEN 1 AND 5),
  ADD CONSTRAINT "reviews_tags_present" CHECK ("tags" IS NOT NULL AND array_position("tags", NULL) IS NULL),
  ADD CONSTRAINT "reviews_comment_present" CHECK ("comment" IS NULL OR btrim("comment") <> ''),
  ADD CONSTRAINT "reviews_hidden_has_reason"
    CHECK (("hidden_at" IS NULL) = ("hidden_reason" IS NULL) AND ("hidden_reason" IS NULL OR btrim("hidden_reason") <> '')),
  ADD CONSTRAINT "reviews_reported_has_reason"
    CHECK (("reported_at" IS NULL) = ("report_reason" IS NULL) AND ("report_reason" IS NULL OR btrim("report_reason") <> ''));

-- The job's customer reviews the job's worker, once the work has been sent for sign-off. The 7 days run from
-- created_at; after them the rating, tags and comment are fixed. Moderation (report, hide) works any time.
CREATE FUNCTION "review_rules"() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $fn$
DECLARE
  job_status text;
  job_customer uuid;
  job_worker uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    EXECUTE format('SELECT status::text, customer_id, worker_id FROM %I.jobs WHERE id = $1', TG_TABLE_SCHEMA)
      INTO job_status, job_customer, job_worker USING NEW.job_id;
    IF job_status NOT IN ('SUBMITTED', 'COMPLETED') THEN
      RAISE EXCEPTION 'job is %: it can be reviewed once the work is done', job_status USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.reviewer_id IS DISTINCT FROM job_customer OR NEW.worker_id IS DISTINCT FROM job_worker THEN
      RAISE EXCEPTION 'a review is by the job''s customer about the job''s worker' USING ERRCODE = 'check_violation';
    END IF;
    NEW.editable_until := NEW.created_at + interval '7 days';
    RETURN NEW;
  END IF;

  IF (NEW.job_id, NEW.reviewer_id, NEW.worker_id) IS DISTINCT FROM (OLD.job_id, OLD.reviewer_id, OLD.worker_id) THEN
    RAISE EXCEPTION 'a review can''t move to another job or person' USING ERRCODE = 'check_violation';
  END IF;
  NEW.created_at := OLD.created_at;
  NEW.editable_until := OLD.editable_until;
  IF (NEW.rating, NEW.tags, NEW.comment) IS DISTINCT FROM (OLD.rating, OLD.tags, OLD.comment)
     AND now() > OLD.editable_until THEN
    RAISE EXCEPTION 'reviews can be edited for 7 days: this one was fixed at %', OLD.editable_until
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$fn$;

CREATE TRIGGER "reviews_rules" BEFORE INSERT OR UPDATE ON "reviews"
  FOR EACH ROW EXECUTE FUNCTION "review_rules"();

-- Office queue (F12): reported reviews not yet hidden, oldest first.
CREATE INDEX "reviews_reported_queue" ON "reviews" ("reported_at") WHERE "reported_at" IS NOT NULL AND "hidden_at" IS NULL;

-- Notifications ----------------------------------------------------------------------------------------------
ALTER TABLE "notifications"
  ADD CONSTRAINT "notifications_type_format" CHECK ("type" ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$'),
  ADD CONSTRAINT "notifications_payload_object" CHECK (jsonb_typeof("payload") = 'object'),
  ADD CONSTRAINT "notifications_channels_present"
    CHECK ("channels_sent" IS NOT NULL AND array_position("channels_sent", NULL) IS NULL);

-- The bell's unread count.
CREATE INDEX "notifications_unread" ON "notifications" ("user_id", "created_at") WHERE "read_at" IS NULL;

-- Problem reports --------------------------------------------------------------------------------------------
-- An OPEN problem has no resolution; a RESOLVED one has its note and time (stamped by the database).
ALTER TABLE "problem_reports"
  ADD CONSTRAINT "problem_reports_topic_present" CHECK (btrim("topic") <> ''),
  ADD CONSTRAINT "problem_reports_details_present" CHECK (btrim("details") <> ''),
  ADD CONSTRAINT "problem_reports_resolution_matches_status" CHECK (
    CASE "status"
      WHEN 'OPEN' THEN "resolution" IS NULL AND "resolved_at" IS NULL AND "resolved_by_id" IS NULL
      ELSE btrim(coalesce("resolution", '')) <> '' AND "resolved_at" IS NOT NULL
    END);

ALTER TABLE "problem_report_photos"
  ADD CONSTRAINT "problem_report_photos_path_present" CHECK (btrim("path") <> '');

-- Only the job's customer or worker reports a problem on it, and a report stays on its job. Resolving stamps the
-- time; reopening clears the resolution.
CREATE FUNCTION "problem_report_rules"() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $fn$
DECLARE
  job_customer uuid;
  job_worker uuid;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.job_id IS DISTINCT FROM OLD.job_id THEN
    RAISE EXCEPTION 'a problem report can''t move to another job' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'INSERT' OR NEW.reported_by_id IS DISTINCT FROM OLD.reported_by_id THEN
    EXECUTE format('SELECT customer_id, worker_id FROM %I.jobs WHERE id = $1', TG_TABLE_SCHEMA)
      INTO job_customer, job_worker USING NEW.job_id;
    IF NEW.reported_by_id IS DISTINCT FROM job_customer AND NEW.reported_by_id IS DISTINCT FROM job_worker THEN
      RAISE EXCEPTION 'only the job''s customer or worker can report a problem on it' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'OPEN' THEN
      RAISE EXCEPTION 'a problem report starts OPEN' USING ERRCODE = 'check_violation';
    END IF;
  ELSIF OLD.status = 'OPEN' AND NEW.status = 'RESOLVED' THEN
    NEW.resolved_at := now();
  ELSIF OLD.status = 'RESOLVED' AND NEW.status = 'OPEN' THEN
    NEW.resolution := NULL;
    NEW.resolved_at := NULL;
    NEW.resolved_by_id := NULL;
  ELSIF NEW.status = 'RESOLVED' THEN
    NEW.resolved_at := OLD.resolved_at;
  END IF;
  RETURN NEW;
END
$fn$;

CREATE TRIGGER "problem_reports_rules" BEFORE INSERT OR UPDATE ON "problem_reports"
  FOR EACH ROW EXECUTE FUNCTION "problem_report_rules"();

-- The 48h auto sign-off asks "does this job have an open problem?" every minute.
CREATE INDEX "problem_reports_open_by_job" ON "problem_reports" ("job_id") WHERE "status" = 'OPEN';

-- Support threads and messages -------------------------------------------------------------------------------
ALTER TABLE "support_threads"
  ADD CONSTRAINT "support_threads_subject_present" CHECK (btrim("subject") <> ''),
  ADD CONSTRAINT "support_threads_closed_has_closed_at" CHECK (("status" = 'CLOSED') = ("closed_at" IS NOT NULL));

ALTER TABLE "support_messages"
  ADD CONSTRAINT "support_messages_body_present" CHECK (btrim("body") <> ''),
  ADD CONSTRAINT "support_messages_internal_from_office" CHECK (NOT "internal" OR "from_office");

-- A thread about a job is from that job's customer or worker; one about a problem report is the reporter's, on
-- the report's job (filled in when left out). Closing stamps the time; reopening clears it.
CREATE FUNCTION "support_thread_rules"() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $fn$
DECLARE
  report_job uuid;
  report_by uuid;
  job_customer uuid;
  job_worker uuid;
BEGIN
  IF NEW.problem_report_id IS NOT NULL THEN
    EXECUTE format('SELECT job_id, reported_by_id FROM %I.problem_reports WHERE id = $1', TG_TABLE_SCHEMA)
      INTO report_job, report_by USING NEW.problem_report_id;
    NEW.job_id := coalesce(NEW.job_id, report_job);
    IF NEW.job_id IS DISTINCT FROM report_job OR NEW.user_id IS DISTINCT FROM report_by THEN
      RAISE EXCEPTION 'a thread about a problem report is the reporter''s, on the same job' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW.job_id IS NOT NULL AND (TG_OP = 'INSERT' OR (NEW.job_id, NEW.user_id) IS DISTINCT FROM (OLD.job_id, OLD.user_id)) THEN
    EXECUTE format('SELECT customer_id, worker_id FROM %I.jobs WHERE id = $1', TG_TABLE_SCHEMA)
      INTO job_customer, job_worker USING NEW.job_id;
    IF NEW.user_id IS DISTINCT FROM job_customer AND NEW.user_id IS DISTINCT FROM job_worker THEN
      RAISE EXCEPTION 'a thread about a job is from its customer or worker' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW.status = 'CLOSED' AND (TG_OP = 'INSERT' OR OLD.status = 'OPEN') THEN
    NEW.closed_at := now();
  ELSIF NEW.status = 'OPEN' THEN
    NEW.closed_at := NULL;
  ELSE
    NEW.closed_at := OLD.closed_at;
  END IF;
  RETURN NEW;
END
$fn$;

CREATE TRIGGER "support_threads_rules" BEFORE INSERT OR UPDATE ON "support_threads"
  FOR EACH ROW EXECUTE FUNCTION "support_thread_rules"();

-- A message is from the thread's person or from the office; the database says which (from the author's role), so
-- an internal note can't come from the person. Messages are a record: they can't be edited, only lose their
-- author when that person is deleted.
CREATE FUNCTION "support_message_rules"() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $fn$
DECLARE
  thread_user uuid;
  author_role text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF (NEW.thread_id, NEW.from_office, NEW.internal, NEW.body, NEW.created_at)
       IS DISTINCT FROM (OLD.thread_id, OLD.from_office, OLD.internal, OLD.body, OLD.created_at)
       OR (NEW.author_id IS DISTINCT FROM OLD.author_id AND NEW.author_id IS NOT NULL) THEN
      RAISE EXCEPTION 'support messages can''t be edited' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  EXECUTE format('SELECT user_id FROM %I.support_threads WHERE id = $1', TG_TABLE_SCHEMA)
    INTO thread_user USING NEW.thread_id;
  EXECUTE format('SELECT role::text FROM %I.profiles WHERE id = $1', TG_TABLE_SCHEMA)
    INTO author_role USING NEW.author_id;
  IF NEW.author_id IS NULL OR (NEW.author_id IS DISTINCT FROM thread_user AND author_role IS DISTINCT FROM 'ADMIN') THEN
    RAISE EXCEPTION 'a support message is from the thread''s person or the office' USING ERRCODE = 'check_violation';
  END IF;
  NEW.from_office := author_role = 'ADMIN' AND NEW.author_id IS DISTINCT FROM thread_user;
  RETURN NEW;
END
$fn$;

CREATE TRIGGER "support_messages_rules" BEFORE INSERT OR UPDATE ON "support_messages"
  FOR EACH ROW EXECUTE FUNCTION "support_message_rules"();

-- Each message moves its thread up the inbox.
CREATE FUNCTION "support_message_bumps_thread"() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $fn$
BEGIN
  EXECUTE format('UPDATE %I.support_threads SET last_message_at = greatest(last_message_at, $2) WHERE id = $1',
                 TG_TABLE_SCHEMA)
    USING NEW.thread_id, NEW.created_at;
  RETURN NULL;
END
$fn$;

CREATE TRIGGER "support_messages_bump_thread" AFTER INSERT ON "support_messages"
  FOR EACH ROW EXECUTE FUNCTION "support_message_bumps_thread"();

-- Audit log --------------------------------------------------------------------------------------------------
-- Append-only. The time is always the insert's; the actor defaults to the one the server names with
-- `SET LOCAL app.actor_id` (as for job status history), and their role is filled in from their profile.
-- before/after are JSON objects.
ALTER TABLE "audit_log"
  ADD CONSTRAINT "audit_log_action_format" CHECK ("action" ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$'),
  ADD CONSTRAINT "audit_log_record_type_present" CHECK (btrim("record_type") <> ''),
  ADD CONSTRAINT "audit_log_record_id_present" CHECK (btrim("record_id") <> ''),
  ADD CONSTRAINT "audit_log_before_object" CHECK ("before" IS NULL OR jsonb_typeof("before") = 'object'),
  ADD CONSTRAINT "audit_log_after_object" CHECK ("after" IS NULL OR jsonb_typeof("after") = 'object'),
  ADD CONSTRAINT "audit_log_reason_present" CHECK ("reason" IS NULL OR btrim("reason") <> '');

CREATE FUNCTION "audit_log_insert"() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $fn$
BEGIN
  NEW.created_at := now();
  NEW.actor_id := coalesce(NEW.actor_id, nullif(current_setting('app.actor_id', true), '')::uuid);
  IF NEW.actor_role IS NULL AND NEW.actor_id IS NOT NULL THEN
    EXECUTE format('SELECT role FROM %I.profiles WHERE id = $1', TG_TABLE_SCHEMA)
      INTO NEW.actor_role USING NEW.actor_id;
  END IF;
  RETURN NEW;
END
$fn$;

CREATE FUNCTION "audit_log_is_append_only"() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $fn$
BEGIN
  RAISE EXCEPTION 'the audit log is append-only: % isn''t allowed', TG_OP USING ERRCODE = 'check_violation';
END
$fn$;

CREATE TRIGGER "audit_log_insert" BEFORE INSERT ON "audit_log"
  FOR EACH ROW EXECUTE FUNCTION "audit_log_insert"();
CREATE TRIGGER "audit_log_no_update_or_delete" BEFORE UPDATE OR DELETE ON "audit_log"
  FOR EACH ROW EXECUTE FUNCTION "audit_log_is_append_only"();
CREATE TRIGGER "audit_log_no_truncate" BEFORE TRUNCATE ON "audit_log"
  FOR EACH STATEMENT EXECUTE FUNCTION "audit_log_is_append_only"();

-- Row-level security -----------------------------------------------------------------------------------------
-- On for every table; read-only, as in Schemas 1–3. None of these tables holds a price, worker pay, an
-- estimate or a margin (materials spend stays in job_materials).
-- - Evidence: the worker reads their own; the customer reads it on their own jobs once it's sent.
-- - Reviews: the customer reads the ones they wrote; the worker reads the visible ones about them.
-- - Notifications, problem reports and support threads: each person reads their own. Office internal notes
--   in support threads are never readable.
-- - trade_evidence_rules and audit_log have no policy: only the server reads them.
ALTER TABLE "trade_evidence_rules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "completion_evidence" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "completion_evidence_photos" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "reviews" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "problem_reports" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "problem_report_photos" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "support_threads" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "support_messages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Workers read their own evidence" ON "completion_evidence" FOR SELECT
  USING ("worker_id" = (SELECT auth.uid()));
CREATE POLICY "Customers read sent evidence on their own jobs" ON "completion_evidence" FOR SELECT
  USING ("submitted_at" IS NOT NULL
         AND EXISTS (SELECT 1 FROM "jobs" j WHERE j."id" = "job_id" AND j."customer_id" = (SELECT auth.uid())));
CREATE POLICY "Workers read their own evidence photos" ON "completion_evidence_photos" FOR SELECT
  USING (EXISTS (SELECT 1 FROM "completion_evidence" e
                 WHERE e."job_id" = "completion_evidence_photos"."job_id" AND e."worker_id" = (SELECT auth.uid())));
CREATE POLICY "Customers read sent evidence photos on their own jobs" ON "completion_evidence_photos" FOR SELECT
  USING (EXISTS (SELECT 1 FROM "completion_evidence" e JOIN "jobs" j ON j."id" = e."job_id"
                 WHERE e."job_id" = "completion_evidence_photos"."job_id" AND e."submitted_at" IS NOT NULL
                   AND j."customer_id" = (SELECT auth.uid())));
CREATE POLICY "Customers read the reviews they wrote" ON "reviews" FOR SELECT
  USING ("reviewer_id" = (SELECT auth.uid()));
CREATE POLICY "Workers read the visible reviews about them" ON "reviews" FOR SELECT
  USING ("worker_id" = (SELECT auth.uid()) AND "hidden_at" IS NULL);
CREATE POLICY "Read own notifications" ON "notifications" FOR SELECT USING ("user_id" = (SELECT auth.uid()));
CREATE POLICY "Read own problem reports" ON "problem_reports" FOR SELECT
  USING ("reported_by_id" = (SELECT auth.uid()));
CREATE POLICY "Read own problem report photos" ON "problem_report_photos" FOR SELECT
  USING (EXISTS (SELECT 1 FROM "problem_reports" r WHERE r."id" = "report_id" AND r."reported_by_id" = (SELECT auth.uid())));
CREATE POLICY "Read own support threads" ON "support_threads" FOR SELECT USING ("user_id" = (SELECT auth.uid()));
CREATE POLICY "Read own support messages, not office notes" ON "support_messages" FOR SELECT
  USING (NOT "internal"
         AND EXISTS (SELECT 1 FROM "support_threads" t WHERE t."id" = "thread_id" AND t."user_id" = (SELECT auth.uid())));
