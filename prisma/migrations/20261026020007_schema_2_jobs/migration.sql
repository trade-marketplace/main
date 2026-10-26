-- CreateEnum
CREATE TYPE "job_status" AS ENUM ('REVIEW', 'QUOTE_BOUNTY', 'PRICED', 'BOOKABLE', 'ASSIGNED', 'SUBMITTED', 'COMPLETED', 'CANCEL_REVIEW', 'CANCELLED');

-- CreateEnum
CREATE TYPE "time_of_day" AS ENUM ('MORNING', 'AFTERNOON', 'EVENING');

-- CreateTable
CREATE TABLE "jobs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "job_number" SERIAL NOT NULL,
    "customer_id" UUID NOT NULL,
    "category" "trade" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "address_line1" TEXT NOT NULL,
    "address_line2" TEXT,
    "suburb" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "postcode" TEXT,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "access_notes" TEXT,
    "asap" BOOLEAN NOT NULL DEFAULT false,
    "any_time" BOOLEAN NOT NULL DEFAULT false,
    "status" "job_status" NOT NULL DEFAULT 'REVIEW',
    "worker_id" UUID,
    "price_cents" INTEGER,
    "booked_date" DATE,
    "booked_time" "time_of_day",
    "edited_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_photos" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "job_id" UUID NOT NULL,
    "path" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "uploaded_by_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_photos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_time_windows" (
    "job_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "time_of_day" "time_of_day" NOT NULL,

    CONSTRAINT "job_time_windows_pkey" PRIMARY KEY ("job_id","date","time_of_day")
);

-- CreateTable
CREATE TABLE "estimates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "job_id" UUID NOT NULL,
    "worker_id" UUID NOT NULL,
    "minutes" INTEGER NOT NULL,
    "materials_cents" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "needs_site_visit" BOOLEAN NOT NULL DEFAULT false,
    "made_before_edit" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "estimates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_pricing" (
    "job_id" UUID NOT NULL,
    "worker_rate_cents" INTEGER NOT NULL,
    "min_minutes" INTEGER NOT NULL,
    "holiday_pay_bps" INTEGER NOT NULL,
    "on_cost_bps" INTEGER NOT NULL,
    "margin_bps" INTEGER NOT NULL,
    "gst_bps" INTEGER NOT NULL,
    "minutes" INTEGER NOT NULL,
    "materials_cents" INTEGER NOT NULL,
    "worker_gross_cents" INTEGER NOT NULL,
    "holiday_pay_cents" INTEGER NOT NULL,
    "on_cost_cents" INTEGER NOT NULL,
    "margin_cents" INTEGER NOT NULL,
    "gst_cents" INTEGER NOT NULL,
    "note" TEXT,
    "priced_by_id" UUID,
    "priced_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_pricing_pkey" PRIMARY KEY ("job_id")
);

-- CreateTable
CREATE TABLE "job_status_history" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "job_id" UUID NOT NULL,
    "from_status" "job_status",
    "to_status" "job_status" NOT NULL,
    "changed_by_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "jobs_job_number_key" ON "jobs"("job_number");

-- CreateIndex
CREATE INDEX "jobs_status_category_idx" ON "jobs"("status", "category");

-- CreateIndex
CREATE INDEX "jobs_status_lat_lng_idx" ON "jobs"("status", "lat", "lng");

-- CreateIndex
CREATE INDEX "jobs_customer_id_created_at_idx" ON "jobs"("customer_id", "created_at");

-- CreateIndex
CREATE INDEX "jobs_worker_id_status_idx" ON "jobs"("worker_id", "status");

-- CreateIndex
CREATE INDEX "job_photos_job_id_position_idx" ON "job_photos"("job_id", "position");

-- CreateIndex
CREATE INDEX "estimates_worker_id_created_at_idx" ON "estimates"("worker_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "estimates_job_id_worker_id_key" ON "estimates"("job_id", "worker_id");

-- CreateIndex
CREATE INDEX "job_status_history_job_id_created_at_idx" ON "job_status_history"("job_id", "created_at");

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_photos" ADD CONSTRAINT "job_photos_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_photos" ADD CONSTRAINT "job_photos_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_time_windows" ADD CONSTRAINT "job_time_windows_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "estimates" ADD CONSTRAINT "estimates_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "estimates" ADD CONSTRAINT "estimates_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_pricing" ADD CONSTRAINT "job_pricing_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_pricing" ADD CONSTRAINT "job_pricing_priced_by_id_fkey" FOREIGN KEY ("priced_by_id") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_status_history" ADD CONSTRAINT "job_status_history_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_status_history" ADD CONSTRAINT "job_status_history_changed_by_id_fkey" FOREIGN KEY ("changed_by_id") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================================================================
-- Hand-written below this line: things schema.prisma can't express. Keep it in sync with the comments there.
-- ============================================================================================================

-- Job numbers are shown as TM-1001 onwards -------------------------------------------------------------------
ALTER SEQUENCE "jobs_job_number_seq" RESTART WITH 1001;

-- updated_at changes on every update, including ones made outside Prisma -------------------------------------
-- (set_updated_at() comes from Schema 1.) An estimate's updated_at is when the worker last saved it, so it
-- only moves when the worker's own fields are written, not when the database flags it below.
CREATE TRIGGER "jobs_set_updated_at" BEFORE UPDATE ON "jobs"
  FOR EACH ROW EXECUTE FUNCTION "set_updated_at"();
CREATE TRIGGER "job_pricing_set_updated_at" BEFORE UPDATE ON "job_pricing"
  FOR EACH ROW EXECUTE FUNCTION "set_updated_at"();
CREATE TRIGGER "estimates_set_updated_at"
  BEFORE UPDATE OF "minutes", "materials_cents", "note", "needs_site_visit" ON "estimates"
  FOR EACH ROW EXECUTE FUNCTION "set_updated_at"();

-- A status history row on every status change ----------------------------------------------------------------
-- Including the first one when the job is posted. The server says who made the change with
-- `SET LOCAL app.actor_id = '<profile id>'` in the same transaction; without it the change is the system's.
-- clock_timestamp() keeps several changes in one transaction in order. These functions find the other tables
-- through TG_TABLE_SCHEMA (usually `public`; tests migrate into their own schema) with an empty search path.
CREATE FUNCTION "record_job_status"() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $fn$
BEGIN
  IF TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status THEN
    EXECUTE format(
      'INSERT INTO %I.job_status_history (job_id, from_status, to_status, changed_by_id, created_at)
       VALUES ($1, $2, $3, $4, clock_timestamp())',
      TG_TABLE_SCHEMA
    ) USING NEW.id,
      CASE WHEN TG_OP = 'UPDATE' THEN OLD.status END,
      NEW.status,
      nullif(current_setting('app.actor_id', true), '')::uuid;
  END IF;
  RETURN NULL;
END
$fn$;

CREATE TRIGGER "jobs_record_status" AFTER INSERT OR UPDATE OF "status" ON "jobs"
  FOR EACH ROW EXECUTE FUNCTION "record_job_status"();

-- Editing a job after estimates exist ------------------------------------------------------------------------
-- edited_at is set whenever what the job is changes: its words, trade, address or photos (photos added in the
-- same transaction that posts the job don't count). Every estimate saved before that is flagged
-- made_before_edit, and the flag clears when the worker saves the estimate again.
CREATE FUNCTION "set_job_edited_at"() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $fn$
BEGIN
  IF (OLD.title, OLD.description, OLD.category, OLD.address_line1, OLD.address_line2, OLD.suburb, OLD.city,
      OLD.postcode, OLD.lat, OLD.lng, OLD.access_notes)
     IS DISTINCT FROM
     (NEW.title, NEW.description, NEW.category, NEW.address_line1, NEW.address_line2, NEW.suburb, NEW.city,
      NEW.postcode, NEW.lat, NEW.lng, NEW.access_notes) THEN
    NEW.edited_at := now();
  END IF;
  RETURN NEW;
END
$fn$;

CREATE TRIGGER "jobs_set_edited_at" BEFORE UPDATE ON "jobs"
  FOR EACH ROW EXECUTE FUNCTION "set_job_edited_at"();

-- Jobs posted in this transaction, so photos saved with the post don't count as an edit.
CREATE FUNCTION "note_job_posted"() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $fn$
BEGIN
  PERFORM set_config('tm.jobs_posted', coalesce(current_setting('tm.jobs_posted', true), '') || ',' || NEW.id, true);
  RETURN NULL;
END
$fn$;

CREATE TRIGGER "jobs_note_posted" AFTER INSERT ON "jobs"
  FOR EACH ROW EXECUTE FUNCTION "note_job_posted"();

CREATE FUNCTION "photo_change_edits_job"() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $fn$
DECLARE
  changed_job uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.job_id ELSE NEW.job_id END;
BEGIN
  IF position(changed_job::text IN coalesce(current_setting('tm.jobs_posted', true), '')) = 0 THEN
    EXECUTE format('UPDATE %I.jobs SET edited_at = now() WHERE id = $1', TG_TABLE_SCHEMA) USING changed_job;
  END IF;
  RETURN NULL;
END
$fn$;

CREATE TRIGGER "job_photos_edit_job" AFTER INSERT OR DELETE OR UPDATE OF "path" ON "job_photos"
  FOR EACH ROW EXECUTE FUNCTION "photo_change_edits_job"();

CREATE FUNCTION "flag_estimates_before_edit"() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $fn$
BEGIN
  IF NEW.edited_at IS DISTINCT FROM OLD.edited_at THEN
    EXECUTE format(
      'UPDATE %I.estimates SET made_before_edit = true WHERE job_id = $1 AND NOT made_before_edit',
      TG_TABLE_SCHEMA
    ) USING NEW.id;
  END IF;
  RETURN NULL;
END
$fn$;

-- No column list: edited_at is usually set by the trigger above, which `UPDATE OF` wouldn't see.
CREATE TRIGGER "jobs_flag_estimates" AFTER UPDATE ON "jobs"
  FOR EACH ROW EXECUTE FUNCTION "flag_estimates_before_edit"();

-- Fires whenever the worker writes their figures, even unchanged ("still right" after an edit).
CREATE FUNCTION "clear_estimate_flag"() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $fn$
BEGIN
  NEW.made_before_edit := false;
  RETURN NEW;
END
$fn$;

CREATE TRIGGER "estimates_clear_flag_on_save"
  BEFORE UPDATE OF "minutes", "materials_cents", "note", "needs_site_visit" ON "estimates"
  FOR EACH ROW EXECUTE FUNCTION "clear_estimate_flag"();

-- An agreed price never changes ------------------------------------------------------------------------------
-- The rates are copied into job_pricing when the office prices the job. Until the customer pays, the office may
-- re-price (REVIEW, QUOTE_BOUNTY, PRICED); after that neither the customer's price nor how it was built
-- (worker pay included) can be written again.
CREATE FUNCTION "job_price_is_frozen"() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $fn$
BEGIN
  IF OLD.price_cents IS DISTINCT FROM NEW.price_cents
     AND OLD.status NOT IN ('REVIEW', 'QUOTE_BOUNTY', 'PRICED') THEN
    RAISE EXCEPTION 'job % is paid: its price can''t change', OLD.job_number USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$fn$;

CREATE TRIGGER "jobs_price_frozen_once_paid" BEFORE UPDATE OF "price_cents" ON "jobs"
  FOR EACH ROW EXECUTE FUNCTION "job_price_is_frozen"();

CREATE FUNCTION "job_pricing_is_frozen"() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $fn$
DECLARE
  job_status text;
BEGIN
  -- A missing job means it is being deleted (cascade), which is allowed.
  EXECUTE format('SELECT status::text FROM %I.jobs WHERE id = $1', TG_TABLE_SCHEMA)
    INTO job_status USING CASE WHEN TG_OP = 'INSERT' THEN NEW.job_id ELSE OLD.job_id END;
  IF job_status NOT IN ('REVIEW', 'QUOTE_BOUNTY', 'PRICED') THEN
    RAISE EXCEPTION 'job is paid: its pricing can''t change' USING ERRCODE = 'check_violation';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END
$fn$;

CREATE TRIGGER "job_pricing_frozen_once_paid" BEFORE INSERT OR UPDATE OR DELETE ON "job_pricing"
  FOR EACH ROW EXECUTE FUNCTION "job_pricing_is_frozen"();

-- Workers book one of the customer's windows (any window when the customer said any time) -------------------
CREATE FUNCTION "booked_window_is_offered"() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $fn$
DECLARE
  offered boolean;
BEGIN
  IF NEW.booked_date IS NULL OR NEW.any_time THEN
    RETURN NEW;
  END IF;
  EXECUTE format(
    'SELECT EXISTS (SELECT 1 FROM %I.job_time_windows WHERE job_id = $1 AND date = $2 AND time_of_day = $3)',
    TG_TABLE_SCHEMA
  ) INTO offered USING NEW.id, NEW.booked_date, NEW.booked_time;
  IF NOT offered THEN
    RAISE EXCEPTION 'job % wasn''t offered that window', NEW.job_number USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$fn$;

CREATE TRIGGER "jobs_booked_window_offered"
  BEFORE INSERT OR UPDATE OF "booked_date", "booked_time", "any_time" ON "jobs"
  FOR EACH ROW EXECUTE FUNCTION "booked_window_is_offered"();

-- Data rules -------------------------------------------------------------------------------------------------
-- Money is whole cents, never negative. A priced job has a price from then on (cancelled before payment may
-- have none), a claimed job has its worker, and nobody works on their own job.
ALTER TABLE "jobs"
  ADD CONSTRAINT "jobs_title_present" CHECK (btrim("title") <> ''),
  ADD CONSTRAINT "jobs_description_present" CHECK (btrim("description") <> ''),
  ADD CONSTRAINT "jobs_address_present"
    CHECK (btrim("address_line1") <> '' AND btrim("suburb") <> '' AND btrim("city") <> ''),
  ADD CONSTRAINT "jobs_point" CHECK (("lat" IS NULL) = ("lng" IS NULL)),
  ADD CONSTRAINT "jobs_lat_range" CHECK ("lat" IS NULL OR "lat" BETWEEN -90 AND 90),
  ADD CONSTRAINT "jobs_lng_range" CHECK ("lng" IS NULL OR "lng" BETWEEN -180 AND 180),
  ADD CONSTRAINT "jobs_price_not_negative" CHECK ("price_cents" IS NULL OR "price_cents" >= 0),
  ADD CONSTRAINT "jobs_priced_has_price"
    CHECK ("status" IN ('REVIEW', 'QUOTE_BOUNTY', 'CANCELLED') OR "price_cents" IS NOT NULL),
  ADD CONSTRAINT "jobs_claimed_has_worker"
    CHECK ("status" NOT IN ('ASSIGNED', 'SUBMITTED', 'COMPLETED') OR "worker_id" IS NOT NULL),
  ADD CONSTRAINT "jobs_worker_not_customer" CHECK ("worker_id" IS DISTINCT FROM "customer_id"),
  ADD CONSTRAINT "jobs_booked_window_whole" CHECK (("booked_date" IS NULL) = ("booked_time" IS NULL));

ALTER TABLE "job_photos"
  ADD CONSTRAINT "job_photos_path_present" CHECK (btrim("path") <> ''),
  ADD CONSTRAINT "job_photos_position_not_negative" CHECK ("position" >= 0);

ALTER TABLE "estimates"
  ADD CONSTRAINT "estimates_minutes_positive" CHECK ("minutes" > 0),
  ADD CONSTRAINT "estimates_materials_not_negative" CHECK ("materials_cents" >= 0);

ALTER TABLE "job_pricing"
  ADD CONSTRAINT "job_pricing_rate_positive" CHECK ("worker_rate_cents" > 0),
  ADD CONSTRAINT "job_pricing_minutes" CHECK ("minutes" > 0 AND "min_minutes" >= 0 AND "minutes" >= "min_minutes"),
  ADD CONSTRAINT "job_pricing_percentages"
    CHECK ("holiday_pay_bps" BETWEEN 0 AND 10000 AND "on_cost_bps" BETWEEN 0 AND 10000
           AND "margin_bps" BETWEEN 0 AND 10000 AND "gst_bps" BETWEEN 0 AND 10000),
  ADD CONSTRAINT "job_pricing_amounts_not_negative"
    CHECK ("materials_cents" >= 0 AND "worker_gross_cents" >= 0 AND "holiday_pay_cents" >= 0
           AND "on_cost_cents" >= 0 AND "margin_cents" >= 0 AND "gst_cents" >= 0);

-- Row-level security -----------------------------------------------------------------------------------------
-- On for every table; read-only, as in Schema 1. Customers read their own jobs and what hangs off them (photos,
-- windows, status history), including the price they pay. They never see estimates or job_pricing (worker pay,
-- rates, margin: AGENTS.md §5). Workers read their own estimates only, never anyone else's (they're blind).
-- jobs carries the customer's price, so workers get no policy on it here: what they may see of a job (what
-- they earn, the suburb before claiming) arrives with who-sees-what (#95). job_pricing has no policy at all.
ALTER TABLE "jobs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "job_photos" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "job_time_windows" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "estimates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "job_pricing" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "job_status_history" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Customers read their own jobs" ON "jobs" FOR SELECT USING ("customer_id" = (SELECT auth.uid()));
CREATE POLICY "Customers read their own job photos" ON "job_photos" FOR SELECT
  USING (EXISTS (SELECT 1 FROM "jobs" j WHERE j."id" = "job_id" AND j."customer_id" = (SELECT auth.uid())));
CREATE POLICY "Customers read their own time windows" ON "job_time_windows" FOR SELECT
  USING (EXISTS (SELECT 1 FROM "jobs" j WHERE j."id" = "job_id" AND j."customer_id" = (SELECT auth.uid())));
CREATE POLICY "Customers read their own job history" ON "job_status_history" FOR SELECT
  USING (EXISTS (SELECT 1 FROM "jobs" j WHERE j."id" = "job_id" AND j."customer_id" = (SELECT auth.uid())));
CREATE POLICY "Workers read their own estimates" ON "estimates" FOR SELECT USING ("worker_id" = (SELECT auth.uid()));
