-- D15 bank/tax details: Matt approved the current 3.5% KiwiSaver rate. Keep saved choices unchanged.
ALTER TABLE "payroll_details" DROP CONSTRAINT "payroll_details_kiwisaver_rate";
ALTER TABLE "payroll_details" ALTER COLUMN "kiwisaver_rate_pct" TYPE decimal(3,1);
ALTER TABLE "payroll_details" ADD CONSTRAINT "payroll_details_kiwisaver_rate"
  CHECK ("kiwisaver_rate_pct" IS NULL OR "kiwisaver_rate_pct" IN (3, 3.5, 4, 6, 8, 10));
ALTER TABLE "payroll_details" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "payroll_details" FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN REVOKE ALL ON "payroll_details" FROM anon; END IF;
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN REVOKE ALL ON "payroll_details" FROM authenticated; END IF;
END $$;
