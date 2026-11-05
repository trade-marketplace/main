ALTER TABLE "problem_reports" ADD COLUMN "urgent" BOOLEAN NOT NULL DEFAULT false;

-- Reports and their attachments are read through owner/office server authorization, never direct API grants.
ALTER TABLE "problem_reports" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "problem_report_photos" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "problem_reports", "problem_report_photos" FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON "problem_reports", "problem_report_photos" FROM anon;
  END IF;
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON "problem_reports", "problem_report_photos" FROM authenticated;
  END IF;
END $$;

-- A file can be attached to both its report and support message. Cleanup retains either live reference.
CREATE TRIGGER "queue_deleted_problem_report_photo" AFTER DELETE ON "problem_report_photos"
  FOR EACH ROW EXECUTE FUNCTION "queue_deleted_support_photo"();
