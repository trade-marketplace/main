-- Review only (#185). William reviews this server-only table; no live migration from this task.
CREATE TABLE "help_article_feedback" (
 "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 "article_slug" VARCHAR(100) NOT NULL CHECK (article_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
 "voter_key" VARCHAR(64) NOT NULL CHECK (voter_key ~ '^[a-f0-9]{64}$'),
 "helpful" BOOLEAN NOT NULL,
 "looking_for" VARCHAR(300),
 "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "help_feedback_positive_has_no_note" CHECK (NOT helpful OR looking_for IS NULL)
);
CREATE UNIQUE INDEX "help_article_feedback_article_slug_voter_key_key" ON "help_article_feedback" ("article_slug", "voter_key");
ALTER TABLE "help_article_feedback" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "help_article_feedback" FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN REVOKE ALL ON "help_article_feedback" FROM anon; END IF;
 IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN REVOKE ALL ON "help_article_feedback" FROM authenticated; END IF;
END $$;
