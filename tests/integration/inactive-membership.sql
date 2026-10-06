-- LOCAL ONLY characterization of effective PostgreSQL RLS, not a migration.
-- Invoke in the verified backbeat-dev DB container with psql -v ON_ERROR_STOP=1.
-- Every fixture and mutation is rolled back. Never use a production connection.
BEGIN;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.runtime_environment
    WHERE id = 'backbeat-dev' AND environment = 'development' AND synthetic_only) THEN
    RAISE EXCEPTION 'Refusing test: development marker absent';
  END IF;
END $$;

SELECT set_config('backbeat.fixture_user', gen_random_uuid()::text, true);
SELECT set_config('backbeat.fixture_workspace', gen_random_uuid()::text, true);
SELECT set_config('backbeat.fixture_artist', gen_random_uuid()::text, true);
INSERT INTO auth.users (id, email, raw_user_meta_data)
VALUES (current_setting('backbeat.fixture_user')::uuid,
  'inactive-' || current_setting('backbeat.fixture_user') || '@backbeat.test',
  '{"synthetic_fixture":"inactive-membership-transaction"}'::jsonb);
SELECT set_config('request.jwt.claim.sub', current_setting('backbeat.fixture_user'), true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SET LOCAL ROLE authenticated;
INSERT INTO public.workspaces (id, name)
VALUES (current_setting('backbeat.fixture_workspace')::uuid, 'Synthetic inactive membership test');
INSERT INTO public.workspace_members (workspace_id, user_id, role, status)
VALUES (current_setting('backbeat.fixture_workspace')::uuid, auth.uid(), 'admin', 'active');
INSERT INTO public.artists (id, workspace_id, name)
VALUES (current_setting('backbeat.fixture_artist')::uuid,
  current_setting('backbeat.fixture_workspace')::uuid, 'Synthetic artist');
INSERT INTO public.bookings (workspace_id, artist_id, date, start_time)
VALUES (current_setting('backbeat.fixture_workspace')::uuid,
  current_setting('backbeat.fixture_artist')::uuid, '2030-01-02', '10:30');
INSERT INTO public.promoters (workspace_id, name)
VALUES (current_setting('backbeat.fixture_workspace')::uuid, 'Synthetic promoter');
INSERT INTO public.events (workspace_id, title, date, artist_id)
VALUES (current_setting('backbeat.fixture_workspace')::uuid, 'Synthetic event', '2030-01-02',
  current_setting('backbeat.fixture_artist')::uuid);
DO $$
BEGIN
  IF current_user <> 'authenticated' THEN RAISE EXCEPTION 'Wrong test role'; END IF;
  IF (SELECT count(*) FROM public.artists) <> 1 OR
     (SELECT count(*) FROM public.bookings) <> 1 THEN
    RAISE EXCEPTION 'Active membership precondition failed';
  END IF;
END $$;

-- The trusted fixture operator alone changes membership state.
RESET ROLE;
UPDATE public.workspace_members SET status = 'inactive'
WHERE workspace_id = current_setting('backbeat.fixture_workspace')::uuid
  AND user_id = current_setting('backbeat.fixture_user')::uuid;
SET LOCAL ROLE authenticated;
DO $$
DECLARE affected integer;
BEGIN
  IF current_user <> 'authenticated' THEN RAISE EXCEPTION 'Wrong test role'; END IF;
  IF EXISTS (SELECT 1 FROM public.artists) OR EXISTS (SELECT 1 FROM public.bookings)
    OR EXISTS (SELECT 1 FROM public.promoters) OR EXISTS (SELECT 1 FROM public.events)
    OR EXISTS (SELECT 1 FROM public.workspace_members) THEN
    RAISE EXCEPTION 'Inactive membership still reads workspace data';
  END IF;
  UPDATE public.artists SET name = 'Unauthorized change'
    WHERE id = current_setting('backbeat.fixture_artist')::uuid;
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 0 THEN RAISE EXCEPTION 'Inactive membership updated data'; END IF;
  DELETE FROM public.bookings WHERE workspace_id = current_setting('backbeat.fixture_workspace')::uuid;
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 0 THEN RAISE EXCEPTION 'Inactive membership deleted data'; END IF;
  BEGIN
    INSERT INTO public.artists (workspace_id, name)
    VALUES (current_setting('backbeat.fixture_workspace')::uuid, 'Unauthorized insert');
    RAISE EXCEPTION 'Inactive membership inserted data';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    UPDATE public.onboarding_status SET completed = true,
      workspace_id = current_setting('backbeat.fixture_workspace')::uuid WHERE user_id = auth.uid();
    RAISE EXCEPTION 'Inactive membership selected the workspace';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;
DO $$
BEGIN
  IF (SELECT name FROM public.artists WHERE id = current_setting('backbeat.fixture_artist')::uuid)
    <> 'Synthetic artist' THEN RAISE EXCEPTION 'Stored artist changed'; END IF;
  IF (SELECT count(*) FROM public.bookings WHERE workspace_id = current_setting('backbeat.fixture_workspace')::uuid)
    <> 1 THEN RAISE EXCEPTION 'Stored booking deleted'; END IF;
END $$;
ROLLBACK;
\echo PASS: inactive membership cannot read, insert, update, delete or select workspace data; fixtures rolled back.
