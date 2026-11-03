CREATE TABLE "variation_upload_stages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "path" text NOT NULL UNIQUE,
  "user_id" uuid NOT NULL, "job_id" uuid NOT NULL, "request_key" uuid NOT NULL,
  "expires_at" timestamptz NOT NULL, "finalized_at" timestamptz, "photo_path" text
);
CREATE INDEX "variation_upload_stages_user_id_expires_at_idx" ON "variation_upload_stages"("user_id", "expires_at");
CREATE INDEX "variation_upload_stages_expires_at_idx" ON "variation_upload_stages"("expires_at");
ALTER TABLE "variation_upload_stages" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "variation_upload_stages" FROM PUBLIC;
DO $roles$ BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN REVOKE ALL ON "variation_upload_stages" FROM anon; END IF;
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN REVOKE ALL ON "variation_upload_stages" FROM authenticated; END IF;
END $roles$;

-- Raw originals use signed upload capabilities only. No browser read/write policies, no public viewing URLs.
-- Final photos are written to the existing private photos bucket only after actual-byte validation/processing.
DO $storage$ BEGIN
  IF to_regclass('storage.buckets') IS NULL THEN RETURN; END IF;
  INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  VALUES ('variation-uploads', 'variation-uploads', false, 10485760,
    ARRAY['image/jpeg', 'image/png', 'image/heic', 'image/heif', 'application/octet-stream'])
  ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;
END $storage$;
