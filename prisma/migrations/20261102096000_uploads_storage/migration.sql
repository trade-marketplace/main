-- Upload service (#96): private Storage buckets, who may read from them, and one row per photo per job.

-- A retry that arrives twice must not add the same photo twice. The upload service names a photo after its content,
-- so the same picture on the same job is the same (job_id, path).
CREATE UNIQUE INDEX "job_photos_job_id_path_key" ON "job_photos"("job_id", "path");

-- Storage only exists on Supabase. On a plain Postgres (tests, local) there is no `storage` schema and this is skipped.
DO $storage$
BEGIN
  IF to_regclass('storage.buckets') IS NULL OR to_regclass('storage.objects') IS NULL THEN
    RETURN;
  END IF;

  -- Private buckets: no public URLs, 10 MB, only the file types the service writes (it re-encodes pictures to WebP).
  INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  VALUES
    ('photos', 'photos', false, 10485760, ARRAY['image/webp']),
    ('documents', 'documents', false, 10485760, ARRAY['application/pdf', 'image/webp'])
  ON CONFLICT (id) DO UPDATE
    SET public = false, file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;

  -- Files are written by the server with the secret key (which skips these policies). Nobody gets insert, update or
  -- delete from the browser. Reading is allowed to exactly the people who may see the job (mirrors
  -- src/server/files/access.ts); the app hands out signed links, and these stop anyone listing or fetching around it.
  DROP POLICY IF EXISTS "Job photos readable by people who can see the job" ON storage.objects;
  CREATE POLICY "Job photos readable by people who can see the job" ON storage.objects FOR SELECT TO authenticated
    USING (
      bucket_id = 'photos'
      AND (storage.foldername(name))[1] = 'jobs'
      AND EXISTS (
        SELECT 1 FROM public."jobs" j
        WHERE j."id"::text = (storage.foldername(name))[2]
          AND (
            j."customer_id" = (SELECT auth.uid())
            OR j."worker_id" = (SELECT auth.uid())
            OR EXISTS (SELECT 1 FROM public."profiles" p WHERE p."id" = (SELECT auth.uid()) AND p."role" = 'ADMIN')
            OR (
              j."status" IN ('REVIEW', 'QUOTE_BOUNTY', 'BOOKABLE')
              AND EXISTS (SELECT 1 FROM public."profiles" p WHERE p."id" = (SELECT auth.uid()) AND p."role" = 'TRADIE')
            )
          )
      )
    );

  DROP POLICY IF EXISTS "Documents readable by their owner and the office" ON storage.objects;
  CREATE POLICY "Documents readable by their owner and the office" ON storage.objects FOR SELECT TO authenticated
    USING (
      bucket_id = 'documents'
      AND (
        (storage.foldername(name))[2] = (SELECT auth.uid())::text
        OR EXISTS (SELECT 1 FROM public."profiles" p WHERE p."id" = (SELECT auth.uid()) AND p."role" = 'ADMIN')
      )
    );
END
$storage$;
