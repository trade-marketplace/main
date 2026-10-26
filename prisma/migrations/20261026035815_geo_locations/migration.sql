-- CreateEnum
CREATE TYPE "location_source" AS ENUM ('SEARCH', 'PIN', 'TYPED');

-- CreateEnum
CREATE TYPE "coverage_check" AS ENUM ('INSIDE', 'OUTSIDE', 'CHECK_LATER');

-- AlterTable
ALTER TABLE "addresses" ADD COLUMN     "location_source" "location_source";

-- AlterTable
ALTER TABLE "jobs" ADD COLUMN     "approx_lat" DOUBLE PRECISION,
ADD COLUMN     "approx_lng" DOUBLE PRECISION,
ADD COLUMN     "coverage" "coverage_check",
ADD COLUMN     "location_needs_check" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "location_source" "location_source";

-- CreateIndex
CREATE INDEX "jobs_location_needs_check_created_at_idx" ON "jobs"("location_needs_check", "created_at");

-- ============================================================================================================
-- Hand-written below this line: things schema.prisma can't express. Keep it in sync with the comments there.
-- Addresses, coverage and distances (#97). Only columns on the existing jobs and addresses tables.
-- ============================================================================================================

-- Where a location came from -----------------------------------------------------------------------------------
-- Picked from search or a dropped pin: there is a point. Typed while search was down: there isn't (yet).
-- Rows from before #97 have no source and keep whatever they had.
ALTER TABLE "addresses"
  ADD CONSTRAINT "addresses_location_source_point"
    CHECK ("location_source" IS NULL OR ("location_source" = 'TYPED') = ("lat" IS NULL));

ALTER TABLE "jobs"
  ADD CONSTRAINT "jobs_location_source_point"
    CHECK ("location_source" IS NULL OR ("location_source" = 'TYPED') = ("lat" IS NULL)),
  -- Nothing was checked, so the office has to.
  ADD CONSTRAINT "jobs_check_later_flagged"
    CHECK ("coverage" IS DISTINCT FROM 'CHECK_LATER' OR "location_needs_check");

-- The approximate pin --------------------------------------------------------------------------------------------
-- Both parts or neither, only for a job with a real point, and never the real point itself.
ALTER TABLE "jobs"
  ADD CONSTRAINT "jobs_approx_point" CHECK (("approx_lat" IS NULL) = ("approx_lng" IS NULL)),
  ADD CONSTRAINT "jobs_approx_needs_point" CHECK ("approx_lat" IS NULL OR "lat" IS NOT NULL),
  ADD CONSTRAINT "jobs_approx_lat_range" CHECK ("approx_lat" IS NULL OR "approx_lat" BETWEEN -90 AND 90),
  ADD CONSTRAINT "jobs_approx_lng_range" CHECK ("approx_lng" IS NULL OR "approx_lng" BETWEEN -180 AND 180),
  ADD CONSTRAINT "jobs_approx_not_exact"
    CHECK ("approx_lat" IS NULL OR "approx_lat" <> "lat" OR "approx_lng" <> "lng");

-- Moving the job's point without a new approximate pin clears the old one, so the map never shows a pin near
-- the old address. The server always writes both together (saveJobLocation in src/server/geo/job-location.ts).
CREATE FUNCTION "clear_stale_approx_pin"() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $fn$
BEGIN
  IF (NEW.lat, NEW.lng) IS DISTINCT FROM (OLD.lat, OLD.lng)
     AND (NEW.approx_lat, NEW.approx_lng) IS NOT DISTINCT FROM (OLD.approx_lat, OLD.approx_lng) THEN
    NEW.approx_lat := NULL;
    NEW.approx_lng := NULL;
  END IF;
  RETURN NEW;
END
$fn$;

CREATE TRIGGER "jobs_clear_stale_approx_pin" BEFORE UPDATE OF "lat", "lng" ON "jobs"
  FOR EACH ROW EXECUTE FUNCTION "clear_stale_approx_pin"();
