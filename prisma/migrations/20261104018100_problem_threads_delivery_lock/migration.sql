-- The Auth->profile deletion hook and FK cascades already run with table-owner rights. Keep this trigger
-- SECURITY INVOKER; serialize its enqueue with upload/attachment/cleanup, without adding elevated access.
CREATE OR REPLACE FUNCTION "queue_deleted_support_photo"() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $fn$
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('support-photo:' || OLD.path, 0));
  EXECUTE format('INSERT INTO %I.support_photo_cleanup(path) VALUES($1) ON CONFLICT(path) DO NOTHING', TG_TABLE_SCHEMA) USING OLD.path;
  RETURN OLD;
END $fn$;
REVOKE ALL ON FUNCTION "queue_deleted_support_photo"() FROM PUBLIC;
DO $roles$ BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN REVOKE ALL ON FUNCTION "queue_deleted_support_photo"() FROM anon; END IF;
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN REVOKE ALL ON FUNCTION "queue_deleted_support_photo"() FROM authenticated; END IF;
END $roles$;
