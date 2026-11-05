-- Quote points (#488): an append-only ledger. The balance is SUM(delta) per worker.
CREATE TYPE "PointReason" AS ENUM ('QUOTE', 'CLAIM', 'OFFICE');

CREATE TABLE "point_entries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "worker_id" UUID NOT NULL,
    "job_id" UUID,
    "delta" INTEGER NOT NULL,
    "reason" "PointReason" NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "point_entries_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "point_entries_delta_not_zero" CHECK ("delta" <> 0),
    -- Quotes earn, claims spend; office adjustments can go either way.
    CONSTRAINT "point_entries_delta_sign" CHECK (("reason" = 'QUOTE' AND "delta" > 0) OR ("reason" = 'CLAIM' AND "delta" < 0) OR "reason" = 'OFFICE')
);

CREATE UNIQUE INDEX "point_entries_worker_id_job_id_reason_key" ON "point_entries"("worker_id", "job_id", "reason");
CREATE INDEX "point_entries_worker_id_created_at_idx" ON "point_entries"("worker_id", "created_at");

ALTER TABLE "point_entries" ADD CONSTRAINT "point_entries_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "point_entries" ADD CONSTRAINT "point_entries_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Quotes made before points existed count too, once each, so editing an old quote never earns a "first" point.
INSERT INTO "point_entries" ("worker_id", "job_id", "delta", "reason", "created_at")
SELECT "worker_id", "job_id", 1, 'QUOTE', "created_at" FROM "estimates"
ON CONFLICT ("worker_id", "job_id", "reason") DO NOTHING;

-- Server-only, like every app table: no policies, so the browser's Supabase roles can't read or write it.
ALTER TABLE "point_entries" ENABLE ROW LEVEL SECURITY;
