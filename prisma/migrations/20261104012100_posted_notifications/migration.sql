-- G05 confirmation and explicitly opted-in customer price-ready push. Browser roles have no table access.
CREATE TABLE job_post_confirmations (
  job_id uuid PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE ON UPDATE CASCADE,
  customer_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE ON UPDATE CASCADE,
  recipient_email text NOT NULL,
  job_number integer NOT NULL,
  title text NOT NULL,
  message jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  due_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  attempts integer NOT NULL DEFAULT 0,
  first_attempt_at timestamptz,
  lease_token uuid,
  leased_until timestamptz,
  delivered_at timestamptz,
  failed_at timestamptz
);
CREATE INDEX job_post_confirmations_due_idx ON job_post_confirmations(delivered_at, failed_at, due_at);
CREATE INDEX job_post_confirmations_customer_id_idx ON job_post_confirmations(customer_id);

CREATE TABLE browser_push_registrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE ON UPDATE CASCADE,
  device_hash char(64) NOT NULL UNIQUE,
  token_hash char(64) NOT NULL UNIQUE,
  token text NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX browser_push_registrations_user_id_revoked_at_idx ON browser_push_registrations(user_id, revoked_at);

CREATE TABLE price_ready_push_deliveries (
  notification_id uuid NOT NULL REFERENCES notifications(id) ON DELETE CASCADE ON UPDATE CASCADE,
  registration_id uuid NOT NULL REFERENCES browser_push_registrations(id) ON DELETE CASCADE ON UPDATE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE ON UPDATE CASCADE,
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE ON UPDATE CASCADE,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  due_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  attempts integer NOT NULL DEFAULT 0,
  lease_token uuid,
  leased_until timestamptz,
  delivered_at timestamptz,
  displayed_at timestamptz,
  failed_at timestamptz,
  PRIMARY KEY(notification_id, registration_id)
);
CREATE INDEX price_ready_push_deliveries_due_idx ON price_ready_push_deliveries(delivered_at, failed_at, due_at);
CREATE INDEX price_ready_push_deliveries_user_id_idx ON price_ready_push_deliveries(user_id);
CREATE INDEX price_ready_push_deliveries_job_id_idx ON price_ready_push_deliveries(job_id);

-- This covers createNotify(tx) and standalone notification inserts atomically without enabling a global adapter.
CREATE FUNCTION queue_customer_price_ready_push() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $function$
DECLARE claimed_job text;
BEGIN
  IF NEW.type <> 'job.priced' OR jsonb_typeof(NEW.payload) <> 'object' THEN RETURN NEW; END IF;
  claimed_job := NEW.payload->>'jobId';
  IF claimed_job IS NULL OR claimed_job !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RETURN NEW; END IF;
  EXECUTE format($query$
    INSERT INTO %1$I.price_ready_push_deliveries(notification_id, registration_id, user_id, job_id)
    SELECT $1, r.id, $2, j.id
    FROM %1$I.jobs j
    JOIN %1$I.profiles p ON p.id = j.customer_id
    JOIN %1$I.notification_preferences pref ON pref.user_id = p.id AND pref.event = 'job.priced' AND pref.channel = 'PUSH' AND pref.enabled
    JOIN %1$I.browser_push_registrations r ON r.user_id = p.id AND r.revoked_at IS NULL
    WHERE j.id = $3 AND j.customer_id = $2 AND j.status = 'PRICED' AND p.role = 'CUSTOMER' AND p.email_verified_at IS NOT NULL
    ON CONFLICT(notification_id, registration_id) DO NOTHING
  $query$, TG_TABLE_SCHEMA) USING NEW.id, NEW.user_id, claimed_job::uuid;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER notifications_queue_customer_price_ready_push
AFTER INSERT ON notifications FOR EACH ROW EXECUTE FUNCTION queue_customer_price_ready_push();

ALTER TABLE job_post_confirmations ENABLE ROW LEVEL SECURITY;
ALTER TABLE browser_push_registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE price_ready_push_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE job_post_confirmations, browser_push_registrations, price_ready_push_deliveries FROM PUBLIC;
REVOKE ALL ON FUNCTION queue_customer_price_ready_push() FROM PUBLIC;
DO $permissions$
DECLARE browser_role text; schema_name text := current_schema();
BEGIN
  FOREACH browser_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = browser_role) THEN
      EXECUTE format('REVOKE ALL ON TABLE %I.job_post_confirmations, %I.browser_push_registrations, %I.price_ready_push_deliveries FROM %I', schema_name, schema_name, schema_name, browser_role);
      EXECUTE format('REVOKE ALL ON FUNCTION %I.queue_customer_price_ready_push() FROM %I', schema_name, browser_role);
    END IF;
  END LOOP;
END;
$permissions$;
