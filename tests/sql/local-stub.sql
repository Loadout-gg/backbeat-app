-- Minimal stand-in for the Supabase roles and auth schema, for the throwaway local
-- cluster only. It is NOT Supabase Auth: auth.uid() just reads a session setting.
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE SCHEMA auth;
CREATE TABLE auth.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text,
  email_confirmed_at timestamptz,
  raw_user_meta_data jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE
AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon') $$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated;
GRANT EXECUTE ON FUNCTION auth.uid(), auth.role() TO anon, authenticated;

CREATE SCHEMA bb_test;
-- Runs one statement as an ordinary signed-in user (role authenticated + stub JWT sub).
-- Returns 'OK:<rows affected>' or the SQLSTATE of the failure.
CREATE FUNCTION bb_test.run_as(actor uuid, statement text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE affected bigint;
BEGIN
  BEGIN
    PERFORM set_config('request.jwt.claim.sub', coalesce(actor::text, ''), true);
    PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    EXECUTE statement;
    GET DIAGNOSTICS affected = ROW_COUNT;
    EXECUTE 'RESET ROLE';
    RETURN 'OK:' || affected;
  EXCEPTION WHEN OTHERS THEN
    EXECUTE 'RESET ROLE';
    RETURN SQLSTATE;
  END;
END
$$;
CREATE FUNCTION bb_test.eq(label text, actual text, expected text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF actual IS DISTINCT FROM expected THEN
    RAISE EXCEPTION 'FAIL %: got %, expected %', label, coalesce(actual, 'NULL'), expected;
  END IF;
  RAISE NOTICE 'PASS %', label;
END
$$;
-- Fixture setup only: puts a booking in any state without firing user triggers.
CREATE FUNCTION bb_test.seed(target_workspace uuid, target_artist uuid, seed_status text,
  seed_date date, seed_hold date DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE new_id uuid;
BEGIN
  SET LOCAL session_replication_role = replica;
  INSERT INTO public.bookings (workspace_id, artist_id, date, start_time, status, hold_expires_on)
    VALUES (target_workspace, target_artist, seed_date, '20:00', seed_status, seed_hold)
    RETURNING id INTO new_id;
  SET LOCAL session_replication_role = origin;
  RETURN new_id;
END
$$;
