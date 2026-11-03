ALTER TABLE "licences" ADD COLUMN "expiry_reminded_at" timestamptz;
CREATE INDEX "licences_due_expiry_reminder_idx" ON "licences" ("expires_on")
  WHERE "status" = 'VERIFIED' AND "expiry_reminded_at" IS NULL;
ALTER TABLE "licences" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "licences" FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN REVOKE ALL ON "licences" FROM anon; END IF;
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN REVOKE ALL ON "licences" FROM authenticated; END IF;
END $$;

-- Originals upload straight to a private staging bucket so Vercel's 4.5 MB request limit cannot cut off the
-- shared 10 MB document allowance. There are no browser read/write policies for this bucket: the server grants
-- a signed, non-overwriting upload for one random path, then validates bytes before writing to `documents`.
DO $storage$
BEGIN
  IF to_regclass('storage.buckets') IS NULL THEN RETURN; END IF;
  INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  VALUES ('licence-uploads', 'licence-uploads', false, 10485760,
    ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/heic', 'image/heif', 'application/octet-stream'])
  ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;
END
$storage$;

CREATE TABLE "licence_upload_stages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid REFERENCES "profiles"("id") ON DELETE SET NULL,
  "path" text NOT NULL UNIQUE,
  "expires_at" timestamptz NOT NULL,
  "finalized_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "licence_upload_stages_user_id_expires_at_idx" ON "licence_upload_stages"("user_id", "expires_at");
CREATE INDEX "licence_upload_stages_expires_at_idx" ON "licence_upload_stages"("expires_at");
ALTER TABLE "licence_upload_stages" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "licence_upload_stages" FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN REVOKE ALL ON "licence_upload_stages" FROM anon; END IF;
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN REVOKE ALL ON "licence_upload_stages" FROM authenticated; END IF;
END $$;
