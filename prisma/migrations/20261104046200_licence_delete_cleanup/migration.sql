-- Removing a licence directly, through a worker trade, or through profile/Auth cascades must retain the final
-- file's cleanup intent. The queue has no holder FK, so deleting the holder cannot delete this intent as well.
CREATE FUNCTION "queue_deleted_licence_document"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF OLD.document_path IS NOT NULL
    AND OLD.document_path ~ ('^licences/' || OLD.user_id::text || '/[0-9a-f]{32}[.](pdf|webp)$') THEN
    -- Serialize deletion/queueing with cleanup's reference check so a shared/current intent cannot be lost.
    PERFORM pg_advisory_xact_lock(hashtextextended('licence-documents:' || OLD.user_id::text, 0));
    EXECUTE format('INSERT INTO %I.licence_document_cleanup (path, user_id) VALUES ($1, $2) ON CONFLICT (path) DO NOTHING', TG_TABLE_SCHEMA)
      USING OLD.document_path, OLD.user_id;
  END IF;
  RETURN OLD;
END
$$;
REVOKE ALL ON FUNCTION "queue_deleted_licence_document"() FROM PUBLIC;
CREATE TRIGGER "licence_deleted_document_cleanup" AFTER DELETE ON "licences"
  FOR EACH ROW EXECUTE FUNCTION "queue_deleted_licence_document"();
ALTER TABLE "licence_document_cleanup" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "licence_document_cleanup" FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON "licence_document_cleanup" FROM anon;
    REVOKE ALL ON FUNCTION "queue_deleted_licence_document"() FROM anon;
  END IF;
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON "licence_document_cleanup" FROM authenticated;
    REVOKE ALL ON FUNCTION "queue_deleted_licence_document"() FROM authenticated;
  END IF;
END $$;
