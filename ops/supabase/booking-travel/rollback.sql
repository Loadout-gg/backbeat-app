-- Rollback of migrations/009_booking_travel_stays.sql. Redeploy the previous app version first.
-- Not lossy: the three tables are renamed to *_rollback_backup with every grant and policy
-- removed (RLS stays on: invisible to the API), and artists.date_of_birth values are copied to
-- artists_date_of_birth_rollback_backup (RLS on, no grants) before the column is dropped.
-- To go forward again: apply 009, then restore.sql. Same explicit target setting as 009:
--   SET backbeat.booking_travel_target = 'hosted:hupkygptbvnzrihrlcxv';
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '15s';
DO $guard$
DECLARE
  target text := pg_catalog.current_setting('backbeat.booking_travel_target', true);
  expected_id text;
  expected_environment text;
BEGIN
  -- Each explicit target must match the synthetic marker of the database it names:
  --   development                  -> backbeat-dev / development (local, migration 001)
  --   hosted:hupkygptbvnzrihrlcxv  -> backbeat-staging / staging (Backbeat staging)
  -- A missing marker table (production shape), zero or several rows, other values, or a
  -- marker that belongs to the other target are all refused.
  IF target = 'development' THEN
    expected_id := 'backbeat-dev'; expected_environment := 'development';
  ELSIF target = 'hosted:hupkygptbvnzrihrlcxv' THEN
    expected_id := 'backbeat-staging'; expected_environment := 'staging';
  ELSE
    RAISE EXCEPTION 'BOOKING_TRAVEL_TARGET_NOT_EXPLICIT';
  END IF;
  IF pg_catalog.to_regclass('public.runtime_environment') IS NULL THEN
    RAISE EXCEPTION 'BOOKING_TRAVEL_SYNTHETIC_MARKER_MISSING';
  END IF;
  IF (SELECT pg_catalog.count(*) FROM public.runtime_environment) <> 1 OR NOT EXISTS (
    SELECT 1 FROM public.runtime_environment
    WHERE id = expected_id AND environment = expected_environment AND synthetic_only IS TRUE
  ) THEN
    RAISE EXCEPTION 'BOOKING_TRAVEL_MARKER_DOES_NOT_MATCH_TARGET';
  END IF;
  IF pg_catalog.to_regprocedure('public.backbeat_is_active_member(uuid)') IS NULL THEN
    RAISE EXCEPTION 'BOOKING_TRAVEL_SHAPE_MISMATCH';
  END IF;
  IF EXISTS (
    SELECT 1 FROM (VALUES ('public.bookings'), ('public.artists'), ('public.workspaces')) AS t(name)
    WHERE pg_catalog.to_regclass(t.name) IS NULL OR NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_class
      WHERE oid = pg_catalog.to_regclass(t.name) AND relrowsecurity)
  ) THEN
    RAISE EXCEPTION 'BOOKING_TRAVEL_PARENT_RLS_REQUIRED';
  END IF;
END
$guard$;
DO $park$
DECLARE
  live text;
  policy text;
  idx record;
BEGIN
  FOR live, policy IN VALUES
    ('booking_travel_legs', 'booking_travel_leg_access'),
    ('booking_stays', 'booking_stay_access'),
    ('artist_travel_documents', 'artist_travel_document_access')
  LOOP
    CONTINUE WHEN pg_catalog.to_regclass('public.' || live) IS NULL;
    IF pg_catalog.to_regclass('public.' || live || '_rollback_backup') IS NOT NULL THEN
      RAISE EXCEPTION 'BOOKING_TRAVEL_ROLLBACK_BACKUP_ALREADY_EXISTS: %', live;
    END IF;
    EXECUTE pg_catalog.format('DROP POLICY IF EXISTS %I ON public.%I', policy, live);
    EXECUTE pg_catalog.format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated', live);
    -- Index names are schema-wide: free them so a later re-apply of 009 can recreate them.
    FOR idx IN
      SELECT c.relname FROM pg_catalog.pg_index AS i
      JOIN pg_catalog.pg_class AS c ON c.oid = i.indexrelid
      WHERE i.indrelid = pg_catalog.to_regclass('public.' || live)
    LOOP
      EXECUTE pg_catalog.format('ALTER INDEX public.%I RENAME TO %I',
        idx.relname, pg_catalog.left(idx.relname, 50) || '_rb');
    END LOOP;
    EXECUTE pg_catalog.format('ALTER TABLE public.%I RENAME TO %I', live, live || '_rollback_backup');
  END LOOP;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
      AND table_name = 'artists' AND column_name = 'date_of_birth') THEN
    CREATE TABLE IF NOT EXISTS public.artists_date_of_birth_rollback_backup (
      artist_id uuid PRIMARY KEY,
      workspace_id uuid NOT NULL,
      date_of_birth date NOT NULL,
      backed_up_at timestamptz NOT NULL DEFAULT pg_catalog.now()
    );
    ALTER TABLE public.artists_date_of_birth_rollback_backup ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON TABLE public.artists_date_of_birth_rollback_backup FROM PUBLIC, anon, authenticated;
    INSERT INTO public.artists_date_of_birth_rollback_backup (artist_id, workspace_id, date_of_birth)
      SELECT id, workspace_id, date_of_birth FROM public.artists WHERE date_of_birth IS NOT NULL
      ON CONFLICT (artist_id) DO NOTHING;
    ALTER TABLE public.artists DROP CONSTRAINT IF EXISTS artists_date_of_birth_check;
    ALTER TABLE public.artists DROP COLUMN date_of_birth;
  END IF;
END
$park$;
NOTIFY pgrst, 'reload schema';
COMMIT;
