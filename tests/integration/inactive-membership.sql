-- LOCAL SYNTHETIC SECURITY GATE ONLY. This is not a migration.
-- Requires a separately approved, verified synthetic Development DB.
-- No environment provisioning, grants or policy changes are performed.
-- Run with psql -X -v ON_ERROR_STOP=1 as the trusted postgres operator.
\set ON_ERROR_STOP on

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SET LOCAL row_security = on;

DO $guard$
BEGIN
  IF session_user <> 'postgres' OR current_user <> 'postgres' THEN
    RAISE EXCEPTION 'Refusing fixture: trusted postgres operator required';
  END IF;

  IF pg_catalog.to_regclass('public.runtime_environment') IS NULL THEN
    RAISE EXCEPTION 'Refusing fixture: development marker absent';
  END IF;

  LOCK TABLE public.runtime_environment IN SHARE MODE;
  IF (SELECT count(*) FROM public.runtime_environment) <> 1
     OR NOT EXISTS (
       SELECT 1 FROM public.runtime_environment
       WHERE id = 'backbeat-dev'
         AND environment = 'development'
         AND synthetic_only IS TRUE
     ) THEN
    RAISE EXCEPTION 'Refusing fixture: exact synthetic singleton required';
  END IF;

  IF pg_catalog.to_regprocedure(
       'public.backbeat_bootstrap_workspace(text)'
     ) IS NULL THEN
    RAISE EXCEPTION 'Refusing fixture: migration 003 prerequisite absent';
  END IF;

  IF pg_catalog.has_table_privilege(
       'authenticated', 'public.workspaces', 'INSERT'
     )
     OR pg_catalog.has_any_column_privilege(
       'authenticated', 'public.workspaces', 'INSERT'
     )
     OR pg_catalog.has_table_privilege(
       'authenticated', 'public.workspace_members', 'INSERT'
     )
     OR pg_catalog.has_any_column_privilege(
       'authenticated', 'public.workspace_members', 'INSERT'
     )
     OR pg_catalog.has_table_privilege(
       'authenticated', 'public.onboarding_status', 'UPDATE'
     )
     OR pg_catalog.has_any_column_privilege(
       'authenticated', 'public.onboarding_status', 'UPDATE'
     ) THEN
    RAISE EXCEPTION 'Refusing fixture: migration 003 grants do not match';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.unnest(
      ARRAY['artists', 'bookings', 'promoters', 'events', 'workspace_members']
    ) AS required(name)
    WHERE NOT coalesce((
      SELECT c.relrowsecurity
      FROM pg_catalog.pg_class AS c
      WHERE c.oid = pg_catalog.to_regclass('public.' || required.name)
    ), false)
  ) THEN
    RAISE EXCEPTION 'Refusing fixture: required RLS relation absent/disabled';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles
    WHERE rolname = 'authenticated' AND (rolsuper OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'Refusing fixture: authenticated bypasses RLS';
  END IF;
END
$guard$;

SELECT
  gen_random_uuid()::text AS fixture_user,
  gen_random_uuid()::text AS fixture_workspace,
  gen_random_uuid()::text AS fixture_artist,
  gen_random_uuid()::text AS fixture_booking,
  gen_random_uuid()::text AS fixture_promoter,
  gen_random_uuid()::text AS fixture_event
\gset

SELECT set_config('backbeat.fixture_user', :'fixture_user', true);
SELECT set_config('backbeat.fixture_workspace', :'fixture_workspace', true);
SELECT set_config('backbeat.fixture_artist', :'fixture_artist', true);
SELECT set_config('backbeat.fixture_booking', :'fixture_booking', true);
SELECT set_config('backbeat.fixture_promoter', :'fixture_promoter', true);
SELECT set_config('backbeat.fixture_event', :'fixture_event', true);

-- Trusted rollback-only fixture setup, before any authenticated role switch.
-- The existing auth trigger creates profile/onboarding rows.
INSERT INTO auth.users (
  id, email, role, aud, email_confirmed_at,
  raw_user_meta_data, created_at, updated_at
)
VALUES (
  :'fixture_user'::uuid,
  'inactive-' || :'fixture_user' || '@backbeat.test',
  'authenticated',
  'authenticated',
  now(),
  '{"synthetic_fixture":"inactive-membership-transaction"}'::jsonb,
  now(),
  now()
);

INSERT INTO public.workspaces (id, name, created_by)
VALUES (
  :'fixture_workspace'::uuid,
  'Synthetic inactive membership test',
  :'fixture_user'::uuid
);

INSERT INTO public.workspace_members (workspace_id, user_id, role, status)
VALUES (
  :'fixture_workspace'::uuid,
  :'fixture_user'::uuid,
  'member',
  'active'
);

INSERT INTO public.artists (id, workspace_id, name)
VALUES (
  :'fixture_artist'::uuid,
  :'fixture_workspace'::uuid,
  'Synthetic artist'
);

INSERT INTO public.bookings (id, workspace_id, artist_id, date, start_time)
VALUES (
  :'fixture_booking'::uuid,
  :'fixture_workspace'::uuid,
  :'fixture_artist'::uuid,
  '2030-01-02',
  '10:30'
);

INSERT INTO public.promoters (id, workspace_id, name)
VALUES (
  :'fixture_promoter'::uuid,
  :'fixture_workspace'::uuid,
  'Synthetic promoter'
);

INSERT INTO public.events (id, workspace_id, title, date, artist_id, promoter_id)
VALUES (
  :'fixture_event'::uuid,
  :'fixture_workspace'::uuid,
  'Synthetic event',
  '2030-01-02',
  :'fixture_artist'::uuid,
  :'fixture_promoter'::uuid
);

UPDATE public.onboarding_status
SET completed = true, workspace_id = :'fixture_workspace'::uuid
WHERE user_id = :'fixture_user'::uuid;

DO $identity$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM auth.users
    WHERE id = current_setting('backbeat.fixture_user')::uuid
      AND email_confirmed_at IS NOT NULL
  ) OR (
    SELECT count(*) FROM public.onboarding_status
    WHERE user_id = current_setting('backbeat.fixture_user')::uuid
      AND completed
      AND workspace_id = current_setting('backbeat.fixture_workspace')::uuid
  ) <> 1 THEN
    RAISE EXCEPTION 'Confirmed identity/onboarding fixture missing';
  END IF;
END
$identity$;

SELECT set_config('request.jwt.claim.sub', :'fixture_user', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', :'fixture_user',
    'role', 'authenticated'
  )::text,
  true
);

SET LOCAL ROLE authenticated;

DO $active$
DECLARE
  relation_name text;
  insert_sql text;
  inserted_id uuid;
  visible_count bigint;
  affected integer;
  fixture_workspace_id uuid := current_setting('backbeat.fixture_workspace')::uuid;
  fixture_artist_id uuid := current_setting('backbeat.fixture_artist')::uuid;
BEGIN
  IF current_user <> 'authenticated'
     OR auth.role() IS DISTINCT FROM 'authenticated'
     OR auth.uid() IS DISTINCT FROM current_setting('backbeat.fixture_user')::uuid THEN
    RAISE EXCEPTION 'Wrong active test role/identity';
  END IF;

  IF (
    SELECT count(*) FROM public.workspace_members
    WHERE workspace_id = current_setting('backbeat.fixture_workspace')::uuid
      AND user_id = auth.uid()
      AND role = 'member'
      AND status = 'active'
  ) <> 1 THEN
    RAISE EXCEPTION 'Active membership precondition failed';
  END IF;

  FOREACH relation_name IN ARRAY ARRAY['artists', 'bookings', 'promoters', 'events']
  LOOP
    EXECUTE format(
      'SELECT count(*) FROM public.%I WHERE workspace_id = $1',
      relation_name
    ) INTO visible_count USING fixture_workspace_id;
    IF visible_count <> 1 THEN
      RAISE EXCEPTION 'Active SELECT precondition failed for %', relation_name;
    END IF;
  END LOOP;

  -- Positive INSERT/UPDATE/DELETE controls under the real authenticated role.
  FOR relation_name, insert_sql IN
    SELECT *
    FROM (VALUES
      ('artists', format(
        'INSERT INTO public.artists (workspace_id, name) VALUES (%L, %L) RETURNING id',
        fixture_workspace_id, 'Disposable active artist'
      )),
      ('bookings', format(
        'INSERT INTO public.bookings (workspace_id, artist_id, date, start_time) VALUES (%L, %L, %L, %L) RETURNING id',
        fixture_workspace_id, fixture_artist_id, '2030-01-03', '10:30'
      )),
      ('promoters', format(
        'INSERT INTO public.promoters (workspace_id, name) VALUES (%L, %L) RETURNING id',
        fixture_workspace_id, 'Disposable active promoter'
      )),
      ('events', format(
        'INSERT INTO public.events (workspace_id, title, date, artist_id) VALUES (%L, %L, %L, %L) RETURNING id',
        fixture_workspace_id, 'Disposable active event', '2030-01-03', fixture_artist_id
      ))
    ) AS statements(relation_name, insert_sql)
  LOOP
    EXECUTE insert_sql INTO inserted_id;
    IF inserted_id IS NULL THEN
      RAISE EXCEPTION 'Active INSERT failed for %', relation_name;
    END IF;

    EXECUTE format(
      'UPDATE public.%I SET id = id WHERE id = $1 AND workspace_id = $2',
      relation_name
    ) USING inserted_id, fixture_workspace_id;
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN
      RAISE EXCEPTION 'Active UPDATE failed for %', relation_name;
    END IF;

    EXECUTE format(
      'DELETE FROM public.%I WHERE id = $1 AND workspace_id = $2',
      relation_name
    ) USING inserted_id, fixture_workspace_id;
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN
      RAISE EXCEPTION 'Active DELETE failed for %', relation_name;
    END IF;
  END LOOP;

  IF public.backbeat_bootstrap_workspace('Existing synthetic workspace')
     IS DISTINCT FROM fixture_workspace_id THEN
    RAISE EXCEPTION 'Active selected-workspace RPC precondition failed';
  END IF;
END
$active$;

RESET ROLE;

-- Snapshot protected rows after successful active controls and before revocation.
SELECT set_config(
  'backbeat.fixture_snapshot',
  jsonb_build_object(
    'artists', (
      SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id)
      FROM public.artists AS a
      WHERE workspace_id = :'fixture_workspace'::uuid
    ),
    'bookings', (
      SELECT jsonb_agg(to_jsonb(b) ORDER BY b.id)
      FROM public.bookings AS b
      WHERE workspace_id = :'fixture_workspace'::uuid
    ),
    'promoters', (
      SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id)
      FROM public.promoters AS p
      WHERE workspace_id = :'fixture_workspace'::uuid
    ),
    'events', (
      SELECT jsonb_agg(to_jsonb(e) ORDER BY e.id)
      FROM public.events AS e
      WHERE workspace_id = :'fixture_workspace'::uuid
    ),
    'onboarding', (
      SELECT to_jsonb(o)
      FROM public.onboarding_status AS o
      WHERE user_id = :'fixture_user'::uuid
    )
  )::text,
  true
);

-- Only the trusted fixture operator changes membership state.
UPDATE public.workspace_members
SET status = 'inactive'
WHERE workspace_id = :'fixture_workspace'::uuid
  AND user_id = :'fixture_user'::uuid;

DO $revoked$
BEGIN
  IF (
    SELECT count(*) FROM public.workspace_members
    WHERE workspace_id = current_setting('backbeat.fixture_workspace')::uuid
      AND user_id = current_setting('backbeat.fixture_user')::uuid
      AND role = 'member'
      AND status = 'inactive'
  ) <> 1 THEN
    RAISE EXCEPTION 'Membership revocation fixture failed';
  END IF;
END
$revoked$;

SET LOCAL ROLE authenticated;

DO $inactive$
DECLARE
  relation_name text;
  insert_sql text;
  visible_count bigint;
  affected integer;
  fixture_workspace_id uuid := current_setting('backbeat.fixture_workspace')::uuid;
  fixture_artist_id uuid := current_setting('backbeat.fixture_artist')::uuid;
BEGIN
  IF current_user <> 'authenticated'
     OR auth.role() IS DISTINCT FROM 'authenticated'
     OR auth.uid() IS DISTINCT FROM current_setting('backbeat.fixture_user')::uuid THEN
    RAISE EXCEPTION 'Wrong inactive test role/identity';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.workspace_members
    WHERE workspace_id = current_setting('backbeat.fixture_workspace')::uuid
  ) THEN
    RAISE EXCEPTION 'Inactive membership remains visible';
  END IF;

  FOREACH relation_name IN ARRAY ARRAY['artists', 'bookings', 'promoters', 'events']
  LOOP
    EXECUTE format(
      'SELECT count(*) FROM public.%I WHERE workspace_id = $1',
      relation_name
    ) INTO visible_count USING fixture_workspace_id;
    IF visible_count <> 0 THEN
      RAISE EXCEPTION 'Inactive SELECT allowed for %', relation_name;
    END IF;

    EXECUTE format(
      'UPDATE public.%I SET id = id WHERE workspace_id = $1',
      relation_name
    ) USING fixture_workspace_id;
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 0 THEN
      RAISE EXCEPTION 'Inactive UPDATE allowed for %', relation_name;
    END IF;

    EXECUTE format(
      'DELETE FROM public.%I WHERE workspace_id = $1',
      relation_name
    ) USING fixture_workspace_id;
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 0 THEN
      RAISE EXCEPTION 'Inactive DELETE allowed for %', relation_name;
    END IF;
  END LOOP;

  FOR relation_name, insert_sql IN
    SELECT *
    FROM (VALUES
      ('artists', format(
        'INSERT INTO public.artists (workspace_id, name) VALUES (%L, %L)',
        fixture_workspace_id, 'Unauthorized artist'
      )),
      ('bookings', format(
        'INSERT INTO public.bookings (workspace_id, artist_id, date, start_time) VALUES (%L, %L, %L, %L)',
        fixture_workspace_id, fixture_artist_id, '2030-01-03', '10:30'
      )),
      ('promoters', format(
        'INSERT INTO public.promoters (workspace_id, name) VALUES (%L, %L)',
        fixture_workspace_id, 'Unauthorized promoter'
      )),
      ('events', format(
        'INSERT INTO public.events (workspace_id, title, date, artist_id) VALUES (%L, %L, %L, %L)',
        fixture_workspace_id, 'Unauthorized event', '2030-01-03', fixture_artist_id
      ))
    ) AS statements(relation_name, insert_sql)
  LOOP
    BEGIN
      EXECUTE insert_sql;
      RAISE EXCEPTION 'Inactive INSERT allowed for %', relation_name;
    EXCEPTION WHEN insufficient_privilege THEN
      NULL;
    END;
  END LOOP;

  BEGIN
    PERFORM public.backbeat_bootstrap_workspace('Must not reactivate');
    RAISE EXCEPTION 'Inactive selected-workspace RPC succeeded';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  BEGIN
    UPDATE public.onboarding_status
    SET completed = true,
        workspace_id = current_setting('backbeat.fixture_workspace')::uuid
    WHERE user_id = auth.uid();
    RAISE EXCEPTION 'Direct onboarding UPDATE unexpectedly permitted';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END
$inactive$;

RESET ROLE;

DO $unchanged$
DECLARE
  actual jsonb;
  fixture_workspace_id uuid := current_setting('backbeat.fixture_workspace')::uuid;
BEGIN
  SELECT jsonb_build_object(
    'artists', (
      SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id)
      FROM public.artists AS a WHERE a.workspace_id = fixture_workspace_id
    ),
    'bookings', (
      SELECT jsonb_agg(to_jsonb(b) ORDER BY b.id)
      FROM public.bookings AS b WHERE b.workspace_id = fixture_workspace_id
    ),
    'promoters', (
      SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id)
      FROM public.promoters AS p WHERE p.workspace_id = fixture_workspace_id
    ),
    'events', (
      SELECT jsonb_agg(to_jsonb(e) ORDER BY e.id)
      FROM public.events AS e WHERE e.workspace_id = fixture_workspace_id
    ),
    'onboarding', (
      SELECT to_jsonb(o) FROM public.onboarding_status AS o
      WHERE o.user_id = current_setting('backbeat.fixture_user')::uuid
    )
  ) INTO actual;

  IF actual IS DISTINCT FROM current_setting('backbeat.fixture_snapshot')::jsonb THEN
    RAISE EXCEPTION 'Protected stored rows changed after inactive operations';
  END IF;
END
$unchanged$;

ROLLBACK;

-- psql variables survive rollback; every fixture and trigger-created row must not.
SELECT
  NOT EXISTS (SELECT 1 FROM auth.users WHERE id = :'fixture_user'::uuid)
  AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = :'fixture_user'::uuid)
  AND NOT EXISTS (
    SELECT 1 FROM public.onboarding_status WHERE user_id = :'fixture_user'::uuid
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.workspaces WHERE id = :'fixture_workspace'::uuid
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.workspace_members WHERE user_id = :'fixture_user'::uuid
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.artists WHERE workspace_id = :'fixture_workspace'::uuid
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.bookings WHERE workspace_id = :'fixture_workspace'::uuid
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.promoters WHERE workspace_id = :'fixture_workspace'::uuid
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.events WHERE workspace_id = :'fixture_workspace'::uuid
  ) AS fixture_clean
\gset

\if :fixture_clean
  \echo PASS: inactive business-data access and workspace selection denied; protected rows unchanged; rollback verified.
\else
  \echo FAIL: rollback cleanup verification failed.
  \quit 1
\endif
