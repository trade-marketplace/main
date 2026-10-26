-- CreateEnum
CREATE TYPE "role" AS ENUM ('CUSTOMER', 'TRADIE', 'ADMIN');

-- CreateEnum
CREATE TYPE "trade" AS ENUM ('ELECTRICAL', 'PLUMBING', 'GAS', 'CONSTRUCTION', 'OTHER');

-- CreateEnum
CREATE TYPE "licence_status" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED');

-- CreateTable
CREATE TABLE "profiles" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "email_verified_at" TIMESTAMPTZ,
    "role" "role" NOT NULL DEFAULT 'CUSTOMER',
    "first_name" TEXT NOT NULL,
    "last_name" TEXT,
    "phone" TEXT,
    "avatar_path" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "worker_profiles" (
    "user_id" UUID NOT NULL,
    "bio" TEXT,
    "base_suburb" TEXT,
    "area_lat" DOUBLE PRECISION,
    "area_lng" DOUBLE PRECISION,
    "area_radius_km" INTEGER,
    "available" BOOLEAN NOT NULL DEFAULT false,
    "verified_at" TIMESTAMPTZ,
    "verified_by_id" UUID,
    "is_quoter" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "worker_profiles_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "worker_trades" (
    "user_id" UUID NOT NULL,
    "trade" "trade" NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "worker_trades_pkey" PRIMARY KEY ("user_id","trade")
);

-- CreateTable
CREATE TABLE "licences" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "trade" "trade" NOT NULL,
    "number" TEXT NOT NULL,
    "type" TEXT,
    "status" "licence_status" NOT NULL DEFAULT 'PENDING',
    "rejection_reason" TEXT,
    "checked_by_id" UUID,
    "checked_at" TIMESTAMPTZ,
    "expires_on" DATE,
    "document_path" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "licences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "addresses" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "label" TEXT,
    "line1" TEXT NOT NULL,
    "line2" TEXT,
    "suburb" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "postcode" TEXT,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_details" (
    "user_id" UUID NOT NULL,
    "ird_number_encrypted" TEXT,
    "ird_number_last3" TEXT,
    "bank_account_encrypted" TEXT,
    "bank_account_last4" TEXT,
    "tax_code" TEXT,
    "kiwisaver_rate_pct" INTEGER,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payroll_details_pkey" PRIMARY KEY ("user_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "profiles_email_key" ON "profiles"("email");

-- CreateIndex
CREATE INDEX "worker_profiles_available_area_lat_area_lng_idx" ON "worker_profiles"("available", "area_lat", "area_lng");

-- CreateIndex
CREATE INDEX "worker_trades_trade_idx" ON "worker_trades"("trade");

-- CreateIndex
CREATE INDEX "licences_status_created_at_idx" ON "licences"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "licences_user_id_trade_key" ON "licences"("user_id", "trade");

-- CreateIndex
CREATE INDEX "addresses_user_id_idx" ON "addresses"("user_id");

-- AddForeignKey
ALTER TABLE "worker_profiles" ADD CONSTRAINT "worker_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "worker_profiles" ADD CONSTRAINT "worker_profiles_verified_by_id_fkey" FOREIGN KEY ("verified_by_id") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "worker_trades" ADD CONSTRAINT "worker_trades_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "licences" ADD CONSTRAINT "licences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "licences" ADD CONSTRAINT "licences_user_id_trade_fkey" FOREIGN KEY ("user_id", "trade") REFERENCES "worker_trades"("user_id", "trade") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "licences" ADD CONSTRAINT "licences_checked_by_id_fkey" FOREIGN KEY ("checked_by_id") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_details" ADD CONSTRAINT "payroll_details_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================================================================
-- Hand-written below this line: things schema.prisma can't express. Keep it in sync with the comments there.
-- ============================================================================================================

-- Supabase stand-ins ----------------------------------------------------------------------------------------
-- On Supabase the `auth` schema, `auth.users` and `auth.uid()` already exist and nothing here runs. On a plain
-- Postgres (local Docker, CI, Prisma's shadow database) this creates minimal versions, so the same migrations
-- run everywhere. `auth.uid()` reads the signed-in user's id from the request the same way Supabase's does.
-- The exception handlers make it safe when several test schemas migrate at the same time.
DO $shim$
BEGIN
  IF to_regnamespace('auth') IS NULL THEN
    BEGIN
      CREATE SCHEMA auth;
    EXCEPTION WHEN duplicate_schema OR unique_violation THEN NULL;
    END;
  END IF;

  IF to_regclass('auth.users') IS NULL THEN
    BEGIN
      CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
    EXCEPTION WHEN duplicate_table OR unique_violation THEN NULL;
    END;
  END IF;

  IF to_regprocedure('auth.uid()') IS NULL THEN
    BEGIN
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $uid$
        SELECT coalesce(
          nullif(current_setting('request.jwt.claim.sub', true), ''),
          (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
        )::uuid
      $uid$;
    EXCEPTION WHEN duplicate_function OR unique_violation THEN NULL;
    END;
  END IF;
END
$shim$;

-- Profiles belong to Supabase Auth users ---------------------------------------------------------------------
-- A foreign key into the `auth` schema would stop Prisma reading the database (it only manages `public`), so
-- two triggers do its job: a profile needs an auth user, and deleting the auth user deletes the profile.
CREATE FUNCTION "profile_needs_auth_user"() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $fn$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = NEW.id) THEN
    RAISE EXCEPTION 'profile % has no Supabase Auth user', NEW.id USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END
$fn$;

CREATE TRIGGER "profiles_need_auth_user"
  BEFORE INSERT OR UPDATE OF "id" ON "profiles"
  FOR EACH ROW EXECUTE FUNCTION "profile_needs_auth_user"();

-- The delete runs as Supabase Auth, so the function pins its search path to this schema (usually `public`;
-- tests migrate into their own schema) and runs with the table owner's rights. The trigger name includes the
-- schema so test schemas sharing one `auth.users` don't clash.
DO $cascade$
BEGIN
  EXECUTE format(
    $sql$
      CREATE FUNCTION %1$I.delete_profile_of_auth_user() RETURNS trigger
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = %1$I AS $fn$
      BEGIN
        DELETE FROM profiles WHERE id = OLD.id;
        RETURN OLD;
      END
      $fn$
    $sql$,
    current_schema()
  );
  EXECUTE format(
    'CREATE TRIGGER %I AFTER DELETE ON auth.users FOR EACH ROW EXECUTE FUNCTION %I.delete_profile_of_auth_user()',
    'delete_profile_' || current_schema(),
    current_schema()
  );
END
$cascade$;

-- Emails are stored lowercased and trimmed, whoever writes them ----------------------------------------------
CREATE FUNCTION "normalize_profile_email"() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $fn$
BEGIN
  NEW.email := lower(btrim(NEW.email));
  RETURN NEW;
END
$fn$;

CREATE TRIGGER "profiles_normalize_email"
  BEFORE INSERT OR UPDATE OF "email" ON "profiles"
  FOR EACH ROW EXECUTE FUNCTION "normalize_profile_email"();

-- updated_at changes on every update, including ones made outside Prisma -------------------------------------
CREATE FUNCTION "set_updated_at"() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $fn$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$fn$;

CREATE TRIGGER "profiles_set_updated_at" BEFORE UPDATE ON "profiles"
  FOR EACH ROW EXECUTE FUNCTION "set_updated_at"();
CREATE TRIGGER "worker_profiles_set_updated_at" BEFORE UPDATE ON "worker_profiles"
  FOR EACH ROW EXECUTE FUNCTION "set_updated_at"();
CREATE TRIGGER "licences_set_updated_at" BEFORE UPDATE ON "licences"
  FOR EACH ROW EXECUTE FUNCTION "set_updated_at"();
CREATE TRIGGER "addresses_set_updated_at" BEFORE UPDATE ON "addresses"
  FOR EACH ROW EXECUTE FUNCTION "set_updated_at"();
CREATE TRIGGER "payroll_details_set_updated_at" BEFORE UPDATE ON "payroll_details"
  FOR EACH ROW EXECUTE FUNCTION "set_updated_at"();

-- Data rules -------------------------------------------------------------------------------------------------
ALTER TABLE "profiles"
  ADD CONSTRAINT "profiles_email_present" CHECK (position('@' IN "email") > 1),
  ADD CONSTRAINT "profiles_first_name_present" CHECK (btrim("first_name") <> ''),
  ADD CONSTRAINT "profiles_phone_e164" CHECK ("phone" IS NULL OR "phone" ~ '^\+[1-9][0-9]{6,14}$');

ALTER TABLE "worker_profiles"
  ADD CONSTRAINT "worker_profiles_area_point" CHECK (("area_lat" IS NULL) = ("area_lng" IS NULL)),
  ADD CONSTRAINT "worker_profiles_area_lat_range" CHECK ("area_lat" IS NULL OR "area_lat" BETWEEN -90 AND 90),
  ADD CONSTRAINT "worker_profiles_area_lng_range" CHECK ("area_lng" IS NULL OR "area_lng" BETWEEN -180 AND 180),
  ADD CONSTRAINT "worker_profiles_area_radius" CHECK ("area_radius_km" IS NULL OR "area_radius_km" BETWEEN 1 AND 200);

-- Other work never needs a licence (DECISIONS.md 1). A decision on a licence records when it was made, and a
-- rejection always says why.
ALTER TABLE "licences"
  ADD CONSTRAINT "licences_not_other" CHECK ("trade" <> 'OTHER'),
  ADD CONSTRAINT "licences_number_present" CHECK (btrim("number") <> ''),
  ADD CONSTRAINT "licences_checked_when_decided" CHECK ("status" = 'PENDING' OR "checked_at" IS NOT NULL),
  ADD CONSTRAINT "licences_rejection_has_reason"
    CHECK ("status" <> 'REJECTED' OR btrim(coalesce("rejection_reason", '')) <> '');

ALTER TABLE "addresses"
  ADD CONSTRAINT "addresses_point" CHECK (("lat" IS NULL) = ("lng" IS NULL)),
  ADD CONSTRAINT "addresses_lat_range" CHECK ("lat" IS NULL OR "lat" BETWEEN -90 AND 90),
  ADD CONSTRAINT "addresses_lng_range" CHECK ("lng" IS NULL OR "lng" BETWEEN -180 AND 180);

-- At most one default address per person.
CREATE UNIQUE INDEX "addresses_one_default_per_user" ON "addresses" ("user_id") WHERE "is_default";

-- The encrypted value and its visible last digits are saved together, and only digits are kept in the clear.
ALTER TABLE "payroll_details"
  ADD CONSTRAINT "payroll_details_ird_pair"
    CHECK (("ird_number_encrypted" IS NULL) = ("ird_number_last3" IS NULL)),
  ADD CONSTRAINT "payroll_details_ird_last3" CHECK ("ird_number_last3" IS NULL OR "ird_number_last3" ~ '^[0-9]{3}$'),
  ADD CONSTRAINT "payroll_details_bank_pair"
    CHECK (("bank_account_encrypted" IS NULL) = ("bank_account_last4" IS NULL)),
  ADD CONSTRAINT "payroll_details_bank_last4"
    CHECK ("bank_account_last4" IS NULL OR "bank_account_last4" ~ '^[0-9]{4}$'),
  ADD CONSTRAINT "payroll_details_kiwisaver_rate"
    CHECK ("kiwisaver_rate_pct" IS NULL OR "kiwisaver_rate_pct" IN (3, 4, 6, 8, 10));

-- Row-level security -----------------------------------------------------------------------------------------
-- On for every table. The browser can reach these tables through Supabase's Data API with the public key, so
-- with no policy a table is closed to it. People may read their own rows; nothing can be written through the
-- Data API (all writes go through our server, which connects as the table owner). payroll_details has no
-- policy at all: only the server reads it. Wider read rules arrive with who-sees-what (#95).
ALTER TABLE "profiles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "worker_profiles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "worker_trades" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "licences" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "addresses" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payroll_details" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Read own profile" ON "profiles" FOR SELECT USING ("id" = (SELECT auth.uid()));
CREATE POLICY "Read own worker profile" ON "worker_profiles" FOR SELECT USING ("user_id" = (SELECT auth.uid()));
CREATE POLICY "Read own trades" ON "worker_trades" FOR SELECT USING ("user_id" = (SELECT auth.uid()));
CREATE POLICY "Read own licences" ON "licences" FOR SELECT USING ("user_id" = (SELECT auth.uid()));
CREATE POLICY "Read own addresses" ON "addresses" FOR SELECT USING ("user_id" = (SELECT auth.uid()));

-- Prisma's own bookkeeping table sits next to ours, so close it to the Data API too.
DO $prisma$
BEGIN
  IF to_regclass('_prisma_migrations') IS NOT NULL THEN
    ALTER TABLE _prisma_migrations ENABLE ROW LEVEL SECURITY;
  END IF;
END
$prisma$;
