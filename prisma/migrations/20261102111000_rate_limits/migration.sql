-- Rate limits (#111). Review by William: a server-only counter table.
-- "key" is an HMAC digest of the limit name and the caller (never an IP address or user id). Rows are deleted once
-- their window has passed ("expires_at").
CREATE TABLE "rate_limit_buckets" (
 "key" VARCHAR(64) NOT NULL CHECK ("key" ~ '^[a-f0-9]{64}$'),
 "window_start" TIMESTAMPTZ NOT NULL,
 "count" INTEGER NOT NULL DEFAULT 1,
 "expires_at" TIMESTAMPTZ NOT NULL,
 PRIMARY KEY ("key", "window_start")
);
CREATE INDEX "rate_limit_buckets_expires_at_idx" ON "rate_limit_buckets" ("expires_at");
ALTER TABLE "rate_limit_buckets" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "rate_limit_buckets" FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN REVOKE ALL ON "rate_limit_buckets" FROM anon; END IF;
 IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN REVOKE ALL ON "rate_limit_buckets" FROM authenticated; END IF;
END $$;
