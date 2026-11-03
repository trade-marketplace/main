CREATE TABLE "support_photo_cleanup" (
  "path" text PRIMARY KEY,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "deleting" boolean NOT NULL DEFAULT false
);
CREATE INDEX "support_photo_cleanup_created_at_path_idx" ON "support_photo_cleanup" ("created_at", "path");
ALTER TABLE "support_photo_cleanup" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "support_photo_cleanup" FROM PUBLIC;
DO $roles$ BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN REVOKE ALL ON "support_photo_cleanup" FROM anon; END IF;
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN REVOKE ALL ON "support_photo_cleanup" FROM authenticated; END IF;
END $roles$;

-- A saved photo is retained while referenced. Deleting the last message/job must queue it again, even if an
-- earlier cleanup already removed its original pending-upload intent. No FK may discard this work on deletion.
CREATE FUNCTION "queue_deleted_support_photo"() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $fn$
BEGIN
  EXECUTE format('INSERT INTO %I.support_photo_cleanup(path) VALUES($1) ON CONFLICT(path) DO NOTHING', TG_TABLE_SCHEMA) USING OLD.path;
  RETURN OLD;
END $fn$;
CREATE TRIGGER "queue_deleted_support_photo" AFTER DELETE ON "support_message_photos"
  FOR EACH ROW EXECUTE FUNCTION "queue_deleted_support_photo"();
