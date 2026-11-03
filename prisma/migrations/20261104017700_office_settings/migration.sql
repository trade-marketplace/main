ALTER TABLE "settings"
  ADD COLUMN "revision" integer NOT NULL DEFAULT 0,
  ADD COLUMN "bounty_amount_cents" integer NOT NULL DEFAULT 3000 CHECK ("bounty_amount_cents" BETWEEN 0 AND 1000000),
  ADD COLUMN "quoter_reward_bps" integer NOT NULL DEFAULT 200 CHECK ("quoter_reward_bps" BETWEEN 0 AND 10000),
  ADD COLUMN "quoter_bonus_cents" integer CHECK ("quoter_bonus_cents" BETWEEN 0 AND 1000000),
  ADD COLUMN "enabled_trades" "trade"[] NOT NULL DEFAULT ARRAY['ELECTRICAL','PLUMBING','GAS','CONSTRUCTION','OTHER']::"trade"[];
ALTER TABLE "settings" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "settings" FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN REVOKE ALL ON "settings" FROM anon; END IF;
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN REVOKE ALL ON "settings" FROM authenticated; END IF;
END $$;

-- A disabled trade accepts neither new jobs nor new claims. Work already assigned can finish.
CREATE FUNCTION "check_job_trade_enabled"() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE allowed boolean;
BEGIN
  IF TG_OP = 'INSERT' OR (OLD.worker_id IS NULL AND NEW.worker_id IS NOT NULL) THEN
    EXECUTE format('SELECT $1 = ANY(enabled_trades) FROM %I.settings WHERE id = 1', TG_TABLE_SCHEMA)
      INTO allowed USING NEW.category;
    IF allowed IS FALSE THEN RAISE EXCEPTION 'Trade is not available' USING ERRCODE = '23514'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "jobs_trade_enabled" BEFORE INSERT OR UPDATE OF worker_id ON "jobs"
  FOR EACH ROW EXECUTE FUNCTION "check_job_trade_enabled"();
REVOKE ALL ON FUNCTION "check_job_trade_enabled"() FROM PUBLIC;
