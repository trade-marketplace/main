-- CreateEnum
CREATE TYPE "payment_kind" AS ENUM ('JOB', 'VARIATION', 'QUICK_LOOK');

-- CreateEnum
CREATE TYPE "payment_status" AS ENUM ('PENDING', 'PAID', 'FAILED', 'REFUNDED', 'PARTIALLY_REFUNDED');

-- CreateEnum
CREATE TYPE "variation_status" AS ENUM ('REQUESTED', 'PRICED', 'APPROVED', 'DECLINED');

-- CreateEnum
CREATE TYPE "payout_status" AS ENUM ('QUEUED', 'EXPORTED', 'PAID');

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "job_id" UUID NOT NULL,
    "kind" "payment_kind" NOT NULL,
    "variation_id" UUID,
    "amount_cents" INTEGER NOT NULL,
    "refunded_cents" INTEGER NOT NULL DEFAULT 0,
    "status" "payment_status" NOT NULL DEFAULT 'PENDING',
    "provider" TEXT NOT NULL DEFAULT 'stripe',
    "provider_payment_id" TEXT,
    "provider_checkout_id" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "livemode" BOOLEAN NOT NULL DEFAULT false,
    "failure_reason" TEXT,
    "paid_at" TIMESTAMPTZ,
    "refunded_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "variations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "job_id" UUID NOT NULL,
    "requested_by_id" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "requested_minutes" INTEGER NOT NULL,
    "requested_materials_cents" INTEGER NOT NULL DEFAULT 0,
    "status" "variation_status" NOT NULL DEFAULT 'REQUESTED',
    "minutes" INTEGER,
    "materials_cents" INTEGER,
    "worker_gross_cents" INTEGER,
    "holiday_pay_cents" INTEGER,
    "on_cost_cents" INTEGER,
    "margin_cents" INTEGER,
    "gst_cents" INTEGER,
    "price_cents" INTEGER,
    "priced_by_id" UUID,
    "priced_at" TIMESTAMPTZ,
    "decided_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "variations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payouts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "job_id" UUID NOT NULL,
    "worker_id" UUID NOT NULL,
    "minutes" INTEGER NOT NULL,
    "rate_cents" INTEGER NOT NULL,
    "gross_cents" INTEGER NOT NULL,
    "holiday_pay_cents" INTEGER NOT NULL,
    "status" "payout_status" NOT NULL DEFAULT 'QUEUED',
    "exported_at" TIMESTAMPTZ,
    "paid_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_materials" (
    "job_id" UUID NOT NULL,
    "budget_cents" INTEGER NOT NULL,
    "spent_cents" INTEGER,
    "receipt_path" TEXT,
    "spent_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_materials_pkey" PRIMARY KEY ("job_id")
);

-- CreateTable
CREATE TABLE "settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "shared_rate_cents" INTEGER NOT NULL DEFAULT 7000,
    "other_rate_cents" INTEGER NOT NULL DEFAULT 3800,
    "shared_min_minutes" INTEGER NOT NULL DEFAULT 120,
    "other_min_minutes" INTEGER NOT NULL DEFAULT 60,
    "holiday_pay_bps" INTEGER NOT NULL DEFAULT 800,
    "on_cost_bps" INTEGER NOT NULL DEFAULT 1250,
    "margin_bps" INTEGER NOT NULL DEFAULT 2000,
    "gst_bps" INTEGER NOT NULL DEFAULT 1500,
    "auto_release_hours" INTEGER NOT NULL DEFAULT 48,
    "quick_look_price_cents" INTEGER NOT NULL DEFAULT 3000,
    "bounty_expiry_hours" INTEGER NOT NULL DEFAULT 24,
    "coverage_centre_lat" DOUBLE PRECISION NOT NULL DEFAULT -46.4132,
    "coverage_centre_lng" DOUBLE PRECISION NOT NULL DEFAULT 168.3538,
    "coverage_radius_km" INTEGER NOT NULL DEFAULT 20,
    "updated_by_id" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payments_provider_payment_id_key" ON "payments"("provider_payment_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_provider_checkout_id_key" ON "payments"("provider_checkout_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_idempotency_key_key" ON "payments"("idempotency_key");

-- CreateIndex
CREATE INDEX "payments_job_id_created_at_idx" ON "payments"("job_id", "created_at");

-- CreateIndex
CREATE INDEX "payments_variation_id_idx" ON "payments"("variation_id");

-- CreateIndex
CREATE INDEX "payments_status_created_at_idx" ON "payments"("status", "created_at");

-- CreateIndex
CREATE INDEX "variations_job_id_created_at_idx" ON "variations"("job_id", "created_at");

-- CreateIndex
CREATE INDEX "variations_status_created_at_idx" ON "variations"("status", "created_at");

-- CreateIndex
CREATE INDEX "payouts_worker_id_created_at_idx" ON "payouts"("worker_id", "created_at");

-- CreateIndex
CREATE INDEX "payouts_status_created_at_idx" ON "payouts"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "payouts_job_id_worker_id_key" ON "payouts"("job_id", "worker_id");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_variation_id_fkey" FOREIGN KEY ("variation_id") REFERENCES "variations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variations" ADD CONSTRAINT "variations_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variations" ADD CONSTRAINT "variations_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variations" ADD CONSTRAINT "variations_priced_by_id_fkey" FOREIGN KEY ("priced_by_id") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_materials" ADD CONSTRAINT "job_materials_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settings" ADD CONSTRAINT "settings_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================================================================
-- Hand-written below this line: things schema.prisma can't express. Keep it in sync with the comments there.
-- ============================================================================================================

-- updated_at changes on every update, including ones made outside Prisma -------------------------------------
-- (set_updated_at() comes from Schema 1.)
CREATE TRIGGER "payments_set_updated_at" BEFORE UPDATE ON "payments"
  FOR EACH ROW EXECUTE FUNCTION "set_updated_at"();
CREATE TRIGGER "variations_set_updated_at" BEFORE UPDATE ON "variations"
  FOR EACH ROW EXECUTE FUNCTION "set_updated_at"();
CREATE TRIGGER "payouts_set_updated_at" BEFORE UPDATE ON "payouts"
  FOR EACH ROW EXECUTE FUNCTION "set_updated_at"();
CREATE TRIGGER "job_materials_set_updated_at" BEFORE UPDATE ON "job_materials"
  FOR EACH ROW EXECUTE FUNCTION "set_updated_at"();
CREATE TRIGGER "settings_set_updated_at" BEFORE UPDATE ON "settings"
  FOR EACH ROW EXECUTE FUNCTION "set_updated_at"();

-- Settings: exactly one row ----------------------------------------------------------------------------------
-- id can only be 1, the migration makes that row with the launch rates (DECISIONS.md #62: $70/hr licensed,
-- $38/hr Other, 2 h / 1 h minimums, 8% holiday pay, 12.5% on-costs, 20% margin, 15% GST; 48 h auto-release,
-- $30 quick look, 24 h bounties; Invercargill, 20 km), and it can't be deleted. The office edits it in place.
ALTER TABLE "settings"
  ADD CONSTRAINT "settings_one_row" CHECK ("id" = 1),
  ADD CONSTRAINT "settings_rates_positive" CHECK ("shared_rate_cents" > 0 AND "other_rate_cents" > 0),
  ADD CONSTRAINT "settings_min_minutes_not_negative" CHECK ("shared_min_minutes" >= 0 AND "other_min_minutes" >= 0),
  ADD CONSTRAINT "settings_percentages"
    CHECK ("holiday_pay_bps" BETWEEN 0 AND 10000 AND "on_cost_bps" BETWEEN 0 AND 10000
           AND "margin_bps" BETWEEN 0 AND 10000 AND "gst_bps" BETWEEN 0 AND 10000),
  ADD CONSTRAINT "settings_hours_positive" CHECK ("auto_release_hours" > 0 AND "bounty_expiry_hours" > 0),
  ADD CONSTRAINT "settings_quick_look_not_negative" CHECK ("quick_look_price_cents" >= 0),
  ADD CONSTRAINT "settings_coverage"
    CHECK ("coverage_centre_lat" BETWEEN -90 AND 90 AND "coverage_centre_lng" BETWEEN -180 AND 180
           AND "coverage_radius_km" > 0);

INSERT INTO "settings" ("id") VALUES (1);

CREATE FUNCTION "settings_stay"() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $fn$
BEGIN
  RAISE EXCEPTION 'settings has exactly one row: change it, don''t delete it' USING ERRCODE = 'check_violation';
END
$fn$;

CREATE TRIGGER "settings_no_delete" BEFORE DELETE ON "settings"
  FOR EACH ROW EXECUTE FUNCTION "settings_stay"();
CREATE TRIGGER "settings_no_truncate" BEFORE TRUNCATE ON "settings"
  FOR EACH STATEMENT EXECUTE FUNCTION "settings_stay"();

-- Payments ---------------------------------------------------------------------------------------------------
-- Whole cents. Refunds, full or partial, are counted in refunded_cents, which never exceeds the amount and must
-- agree with the status. A VARIATION payment names its extra work, and only it does.
ALTER TABLE "payments"
  ADD CONSTRAINT "payments_amount_positive" CHECK ("amount_cents" > 0),
  ADD CONSTRAINT "payments_refund_at_most_amount" CHECK ("refunded_cents" BETWEEN 0 AND "amount_cents"),
  ADD CONSTRAINT "payments_refund_matches_status" CHECK (
    CASE "status"
      WHEN 'REFUNDED' THEN "refunded_cents" = "amount_cents"
      WHEN 'PARTIALLY_REFUNDED' THEN "refunded_cents" > 0 AND "refunded_cents" < "amount_cents"
      ELSE "refunded_cents" = 0
    END),
  ADD CONSTRAINT "payments_paid_has_paid_at" CHECK ("status" IN ('PENDING', 'FAILED') OR "paid_at" IS NOT NULL),
  ADD CONSTRAINT "payments_refund_has_refunded_at" CHECK ("refunded_cents" = 0 OR "refunded_at" IS NOT NULL),
  ADD CONSTRAINT "payments_variation_matches_kind" CHECK (("kind" = 'VARIATION') = ("variation_id" IS NOT NULL)),
  ADD CONSTRAINT "payments_idempotency_key_present" CHECK (btrim("idempotency_key") <> ''),
  ADD CONSTRAINT "payments_provider_present" CHECK (btrim("provider") <> '');

-- One live payment per thing being paid for, so the customer is never charged twice for it. A FAILED one
-- doesn't count, so trying again works.
CREATE UNIQUE INDEX "payments_one_live_per_job" ON "payments" ("job_id", "kind")
  WHERE "kind" IN ('JOB', 'QUICK_LOOK') AND "status" <> 'FAILED';
CREATE UNIQUE INDEX "payments_one_live_per_variation" ON "payments" ("variation_id")
  WHERE "status" <> 'FAILED';

-- The extra work paid for is on the same job; once paid, what was paid for and how much can't change, refunds
-- only go up, and a paid payment can't go back to PENDING or FAILED.
CREATE FUNCTION "payment_rules"() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $fn$
DECLARE
  variation_job uuid;
BEGIN
  IF NEW.variation_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.variation_id IS DISTINCT FROM OLD.variation_id
                                       OR NEW.job_id IS DISTINCT FROM OLD.job_id) THEN
    EXECUTE format('SELECT job_id FROM %I.variations WHERE id = $1', TG_TABLE_SCHEMA)
      INTO variation_job USING NEW.variation_id;
    IF variation_job IS DISTINCT FROM NEW.job_id THEN
      RAISE EXCEPTION 'that extra work is on another job' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status <> 'PENDING'
       AND (OLD.job_id, OLD.kind, OLD.variation_id, OLD.amount_cents)
           IS DISTINCT FROM (NEW.job_id, NEW.kind, NEW.variation_id, NEW.amount_cents) THEN
      RAISE EXCEPTION 'payment is %: what it was for and its amount can''t change', OLD.status
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.refunded_cents < OLD.refunded_cents THEN
      RAISE EXCEPTION 'a refund can''t be taken back' USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.status IN ('PAID', 'PARTIALLY_REFUNDED', 'REFUNDED') AND NEW.status IN ('PENDING', 'FAILED') THEN
      RAISE EXCEPTION 'payment was paid: it can''t go back to %', NEW.status USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$fn$;

CREATE TRIGGER "payments_rules" BEFORE INSERT OR UPDATE ON "payments"
  FOR EACH ROW EXECUTE FUNCTION "payment_rules"();

-- Extra work (variations) ------------------------------------------------------------------------------------
-- The worker's ask is there from the start; the office's figures are all there from PRICED on and all empty
-- before. Times are minutes, money whole cents.
ALTER TABLE "variations"
  ADD CONSTRAINT "variations_description_present" CHECK (btrim("description") <> ''),
  ADD CONSTRAINT "variations_requested_minutes_positive" CHECK ("requested_minutes" > 0),
  ADD CONSTRAINT "variations_requested_materials_not_negative" CHECK ("requested_materials_cents" >= 0),
  ADD CONSTRAINT "variations_priced_has_figures" CHECK (
    CASE WHEN "status" = 'REQUESTED' THEN
      num_nonnulls("minutes", "materials_cents", "worker_gross_cents", "holiday_pay_cents", "on_cost_cents",
                   "margin_cents", "gst_cents", "price_cents", "priced_at") = 0
    ELSE
      num_nulls("minutes", "materials_cents", "worker_gross_cents", "holiday_pay_cents", "on_cost_cents",
                "margin_cents", "gst_cents", "price_cents", "priced_at") = 0
    END),
  ADD CONSTRAINT "variations_minutes_positive" CHECK ("minutes" IS NULL OR "minutes" > 0),
  ADD CONSTRAINT "variations_amounts_not_negative"
    CHECK ("materials_cents" >= 0 AND "worker_gross_cents" >= 0 AND "holiday_pay_cents" >= 0
           AND "on_cost_cents" >= 0 AND "margin_cents" >= 0 AND "gst_cents" >= 0 AND "price_cents" >= 0),
  ADD CONSTRAINT "variations_decided_has_decided_at"
    CHECK (("status" IN ('APPROVED', 'DECLINED')) = ("decided_at" IS NOT NULL));

-- REQUESTED → PRICED → APPROVED | DECLINED. The worker may change their ask until it's priced; the office may
-- re-price while it's PRICED; the customer decides on the price they were shown, and that's final. The
-- database stamps priced_at (each pricing) and decided_at.
CREATE FUNCTION "variation_flow"() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $fn$
DECLARE
  repriced boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'REQUESTED' THEN
      RAISE EXCEPTION 'extra work starts as REQUESTED' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.job_id IS DISTINCT FROM OLD.job_id THEN
    RAISE EXCEPTION 'extra work can''t move to another job' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status
     AND (OLD.status, NEW.status) NOT IN (('REQUESTED', 'PRICED'), ('PRICED', 'APPROVED'), ('PRICED', 'DECLINED')) THEN
    RAISE EXCEPTION 'extra work can''t go from % to %', OLD.status, NEW.status USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status <> 'REQUESTED'
     AND (OLD.description, OLD.requested_minutes, OLD.requested_materials_cents, OLD.requested_by_id)
         IS DISTINCT FROM (NEW.description, NEW.requested_minutes, NEW.requested_materials_cents, NEW.requested_by_id) THEN
    RAISE EXCEPTION 'extra work is priced: the ask can''t change' USING ERRCODE = 'check_violation';
  END IF;

  repriced := (OLD.minutes, OLD.materials_cents, OLD.worker_gross_cents, OLD.holiday_pay_cents, OLD.on_cost_cents,
               OLD.margin_cents, OLD.gst_cents, OLD.price_cents)
              IS DISTINCT FROM
              (NEW.minutes, NEW.materials_cents, NEW.worker_gross_cents, NEW.holiday_pay_cents, NEW.on_cost_cents,
               NEW.margin_cents, NEW.gst_cents, NEW.price_cents);
  IF repriced AND NEW.status <> 'PRICED' THEN
    RAISE EXCEPTION 'extra work is %: its price can''t change', NEW.status USING ERRCODE = 'check_violation';
  END IF;
  IF repriced OR (OLD.status = 'REQUESTED' AND NEW.status = 'PRICED') THEN
    NEW.priced_at := now();
  ELSE
    NEW.priced_at := OLD.priced_at;
  END IF;
  IF OLD.status = 'PRICED' AND NEW.status IN ('APPROVED', 'DECLINED') THEN
    NEW.decided_at := now();
  ELSE
    NEW.decided_at := OLD.decided_at;
  END IF;
  RETURN NEW;
END
$fn$;

CREATE TRIGGER "variations_flow" BEFORE INSERT OR UPDATE ON "variations"
  FOR EACH ROW EXECUTE FUNCTION "variation_flow"();

-- Payouts ----------------------------------------------------------------------------------------------------
-- QUEUED → EXPORTED → PAID, never backwards. Once exported the amounts are with payroll, so they can't change
-- (a correction is an adjustment in the next pay run, not an edit).
ALTER TABLE "payouts"
  ADD CONSTRAINT "payouts_minutes_positive" CHECK ("minutes" > 0),
  ADD CONSTRAINT "payouts_rate_positive" CHECK ("rate_cents" > 0),
  ADD CONSTRAINT "payouts_amounts_not_negative" CHECK ("gross_cents" >= 0 AND "holiday_pay_cents" >= 0),
  ADD CONSTRAINT "payouts_exported_has_exported_at" CHECK ("status" = 'QUEUED' OR "exported_at" IS NOT NULL),
  ADD CONSTRAINT "payouts_paid_has_paid_at" CHECK (("status" = 'PAID') = ("paid_at" IS NOT NULL));

CREATE FUNCTION "payout_is_frozen"() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $fn$
BEGIN
  IF array_position(ARRAY['QUEUED', 'EXPORTED', 'PAID'], NEW.status::text)
     < array_position(ARRAY['QUEUED', 'EXPORTED', 'PAID'], OLD.status::text) THEN
    RAISE EXCEPTION 'payout can''t go back from % to %', OLD.status, NEW.status USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status <> 'QUEUED'
     AND (OLD.job_id, OLD.worker_id, OLD.minutes, OLD.rate_cents, OLD.gross_cents, OLD.holiday_pay_cents)
         IS DISTINCT FROM (NEW.job_id, NEW.worker_id, NEW.minutes, NEW.rate_cents, NEW.gross_cents, NEW.holiday_pay_cents) THEN
    RAISE EXCEPTION 'payout is %: its amounts can''t change', OLD.status USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$fn$;

CREATE TRIGGER "payouts_frozen_once_exported" BEFORE UPDATE ON "payouts"
  FOR EACH ROW EXECUTE FUNCTION "payout_is_frozen"();

-- Materials --------------------------------------------------------------------------------------------------
-- At cost ex GST, whole cents. Spend may go over budget (the app flags it); it's reported with a time.
ALTER TABLE "job_materials"
  ADD CONSTRAINT "job_materials_budget_not_negative" CHECK ("budget_cents" >= 0),
  ADD CONSTRAINT "job_materials_spent_not_negative" CHECK ("spent_cents" IS NULL OR "spent_cents" >= 0),
  ADD CONSTRAINT "job_materials_spent_has_spent_at" CHECK (("spent_cents" IS NULL) = ("spent_at" IS NULL)),
  ADD CONSTRAINT "job_materials_receipt_path_present" CHECK ("receipt_path" IS NULL OR btrim("receipt_path") <> '');

-- Row-level security -----------------------------------------------------------------------------------------
-- On for every table; read-only, as in Schemas 1 and 2. Customers read their own jobs' payments (what they paid
-- and what came back). Workers read their own payouts only. Workers never see payments (the customer's price),
-- and customers never see payouts, variations or materials (worker pay, materials at cost: the margin).
-- variations and job_materials mix both sides, so they have no policy until who-sees-what (#95) decides which
-- part each side gets. settings has no policy at all: only the server reads it.
ALTER TABLE "payments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "variations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payouts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "job_materials" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "settings" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Customers read their own payments" ON "payments" FOR SELECT
  USING (EXISTS (SELECT 1 FROM "jobs" j WHERE j."id" = "job_id" AND j."customer_id" = (SELECT auth.uid())));
CREATE POLICY "Workers read their own payouts" ON "payouts" FOR SELECT USING ("worker_id" = (SELECT auth.uid()));
