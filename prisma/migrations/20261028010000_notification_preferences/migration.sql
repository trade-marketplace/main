-- Review only: schema changes need William's review. Never run against Supabase from this task.
-- In-app remains mandatory. These choices affect optional providers once enabled in the event catalogue.
CREATE TABLE "notification_preferences" (
    "user_id" UUID NOT NULL,
    "channel" "notification_channel" NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("user_id", "channel"),
    CONSTRAINT "notification_preferences_user_id_fkey" FOREIGN KEY ("user_id")
      REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

ALTER TABLE "notification_preferences" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Read own notification preferences" ON "notification_preferences" FOR SELECT
  USING ("user_id" = (SELECT auth.uid()));
-- As with notifications, writes go through authenticated server actions; no Data API write policy.
