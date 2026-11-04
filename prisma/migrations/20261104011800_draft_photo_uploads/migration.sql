-- #118: private raw staging and durable cleanup for processed draft photos.
-- No profile FKs: account deletion must not discard the records needed to remove private files.
CREATE TABLE "draft_photo_stages" (
  "path" text PRIMARY KEY,
  "user_id" uuid NOT NULL,
  "post_key" uuid NOT NULL,
  "size" integer NOT NULL CHECK ("size" > 0 AND "size" <= 10485760),
  "expires_at" timestamptz NOT NULL,
  "claimed_at" timestamptz,
  "finalized_at" timestamptz,
  "final_path" text NOT NULL UNIQUE,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "draft_photo_stages_user_id_expires_at_idx" ON "draft_photo_stages"("user_id", "expires_at");
CREATE INDEX "draft_photo_stages_expires_at_idx" ON "draft_photo_stages"("expires_at");
CREATE TABLE "draft_photo_cleanup" (
  "path" text PRIMARY KEY,
  "user_id" uuid NOT NULL,
  "post_key" uuid NOT NULL,
  "deleting" boolean NOT NULL DEFAULT false,
  "check_after" timestamptz NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "draft_photo_cleanup_check_after_idx" ON "draft_photo_cleanup"("check_after");
ALTER TABLE "draft_photo_stages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "draft_photo_cleanup" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "draft_photo_stages", "draft_photo_cleanup" FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN REVOKE ALL ON "draft_photo_stages", "draft_photo_cleanup" FROM anon; END IF;
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN REVOKE ALL ON "draft_photo_stages", "draft_photo_cleanup" FROM authenticated; END IF;
  IF to_regclass('storage.buckets') IS NOT NULL THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit)
      VALUES ('draft-photo-uploads', 'draft-photo-uploads', false, 10485760)
      ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = 10485760;
  END IF;
END $$;
