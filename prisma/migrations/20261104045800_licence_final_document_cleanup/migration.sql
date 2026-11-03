-- Retryable final-file removal. No FK: cleanup must survive the holder's account being removed.
CREATE TABLE "licence_document_cleanup" (
  "path" text PRIMARY KEY,
  "user_id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "licence_document_cleanup_created_at_idx" ON "licence_document_cleanup"("created_at");
ALTER TABLE "licence_document_cleanup" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "licence_document_cleanup" FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN REVOKE ALL ON "licence_document_cleanup" FROM anon; END IF;
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN REVOKE ALL ON "licence_document_cleanup" FROM authenticated; END IF;
END $$;
