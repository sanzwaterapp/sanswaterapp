-- Run once in the existing project's Supabase SQL Editor as the project admin.
-- This adds durable login throttling; business schema/data remain intact.
CREATE TABLE IF NOT EXISTS depot_private.login_limits (
  key text PRIMARY KEY CHECK (key ~ '^[a-f0-9]{64}$'),
  window_start bigint NOT NULL,
  attempts integer NOT NULL CHECK (attempts BETWEEN 1 AND 11)
);
CREATE INDEX IF NOT EXISTS login_limits_expiry ON depot_private.login_limits(window_start);
ALTER TABLE depot_private.login_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON depot_private.login_limits FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON depot_private.login_limits TO depot_runtime;
DROP POLICY IF EXISTS backend_login_limits ON depot_private.login_limits;
CREATE POLICY backend_login_limits ON depot_private.login_limits
  TO depot_runtime USING (true) WITH CHECK (true);
