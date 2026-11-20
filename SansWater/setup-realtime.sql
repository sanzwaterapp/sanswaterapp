-- Run in the SansWater project's Supabase SQL Editor as project admin.
BEGIN;

-- Speed up single-key replay lookups without changing existing replay records.
CREATE INDEX IF NOT EXISTS depot_replay_user_key ON depot_private.records
  ((payload->>'user_id'), (payload->>'key'))
  WHERE entity='idempotency' AND payload IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'depot_realtime_listener') THEN
    CREATE ROLE depot_realtime_listener NOLOGIN NOINHERIT;
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid = 'realtime.messages'::regclass) THEN
    RAISE EXCEPTION 'Enable RLS on realtime.messages before enabling SansWater Realtime';
  END IF;
END;
$$;

-- Only Realtime can assume this role. PostgREST's authenticator is not granted membership.
GRANT depot_realtime_listener TO supabase_realtime_admin;
GRANT USAGE ON SCHEMA realtime TO depot_realtime_listener;
GRANT SELECT ON realtime.messages TO depot_realtime_listener;

DROP POLICY IF EXISTS sanswater_realtime_read ON realtime.messages;
DROP POLICY IF EXISTS sanswater_realtime_scope ON realtime.messages;
CREATE POLICY sanswater_realtime_read ON realtime.messages
  FOR SELECT TO depot_realtime_listener USING (true);
CREATE POLICY sanswater_realtime_scope ON realtime.messages AS RESTRICTIVE
  FOR SELECT TO depot_realtime_listener USING (
    extension = 'broadcast'
    AND topic = 'sanswater:updates'
    AND (SELECT realtime.topic()) = 'sanswater:updates'
    AND (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'depot_realtime') = 'sanswater:updates'
  );

CREATE OR REPLACE FUNCTION depot_private.broadcast_revision()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM realtime.send(
    pg_catalog.jsonb_build_object('version', NEW.store_id::text || ':' || NEW.revision::text),
    'revision', 'sanswater:updates', true
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Periodic checks cover missed notifications. A broadcast error must not roll back a sale.
  RAISE WARNING 'SansWater Realtime broadcast failed (SQLSTATE %)', SQLSTATE;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION depot_private.broadcast_revision() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS sanswater_broadcast_revision ON depot_private.state;
CREATE TRIGGER sanswater_broadcast_revision
  AFTER UPDATE OF revision, store_id ON depot_private.state
  FOR EACH ROW WHEN (NEW.initialized AND (
    OLD.revision IS DISTINCT FROM NEW.revision OR OLD.store_id IS DISTINCT FROM NEW.store_id
  )) EXECUTE FUNCTION depot_private.broadcast_revision();

COMMIT;
