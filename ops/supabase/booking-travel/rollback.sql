-- Rollback of migrations/009_booking_travel_stays.sql. Redeploy the previous app version first.
-- Not lossy: the six tables are renamed to *_rollback_backup with every grant and policy removed
-- (RLS stays on: invisible to the API; the append-only and delete-protection triggers stay on the
-- parked tables), artists.date_of_birth and bookings.transport_to_city values are copied to their
-- own backup tables before the columns are dropped, and every API entry point of 009 is dropped,
-- so no link can be issued and no lifecycle transition can run while rolled back.
-- Storage is not touched: objects stay in the private bucket, and a database rollback or backup
-- never restores Storage bytes. To go forward again: apply 009, then restore.sql.
-- Same explicit target setting as 009:
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
  idx record;
  pol record;
  fn record;
BEGIN
  -- Entry points first: nothing can authorize, sign, archive, restore or purge after this.
  FOR fn IN
    SELECT p.oid::pg_catalog.regprocedure AS signature FROM pg_catalog.pg_proc AS p
    JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN (
      'backbeat_travel_document_archive', 'backbeat_travel_document_restore',
      'backbeat_travel_document_relationship_end', 'backbeat_travel_document_relationship_resume',
      'backbeat_travel_document_reserve_upload', 'backbeat_travel_document_pending_key',
      'backbeat_travel_document_finalize_upload', 'backbeat_travel_document_authorize_download',
      'backbeat_travel_document_record_issuance', 'backbeat_travel_document_restore_probe',
      'backbeat_travel_document_confirm_restored_file', 'backbeat_travel_document_purge_claim',
      'backbeat_travel_document_cleanup_claim', 'backbeat_travel_document_purge_due',
      'backbeat_travel_document_purge_worklist',
      'backbeat_travel_document_purge_confirm', 'backbeat_travel_document_audit_retention_purge')
  LOOP
    EXECUTE pg_catalog.format('DROP FUNCTION %s', fn.signature);
  END LOOP;

  FOREACH live IN ARRAY ARRAY['booking_travel_legs', 'booking_stays', 'artist_travel_documents',
    'artist_travel_document_files', 'artist_travel_document_audit',
    'artist_travel_document_relationships']
  LOOP
    CONTINUE WHEN pg_catalog.to_regclass('public.' || live) IS NULL;
    IF pg_catalog.to_regclass('public.' || live || '_rollback_backup') IS NOT NULL THEN
      RAISE EXCEPTION 'BOOKING_TRAVEL_ROLLBACK_BACKUP_ALREADY_EXISTS: %', live;
    END IF;
    FOR pol IN SELECT policyname FROM pg_catalog.pg_policies
      WHERE schemaname = 'public' AND tablename = live
    LOOP
      EXECUTE pg_catalog.format('DROP POLICY %I ON public.%I', pol.policyname, live);
    END LOOP;
    EXECUTE pg_catalog.format(
      'REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated, service_role', live);
    -- Index names are schema-wide: free them so a later re-apply of 009 can recreate them.
    FOR idx IN
      SELECT c.relname FROM pg_catalog.pg_index AS i
      JOIN pg_catalog.pg_class AS c ON c.oid = i.indexrelid
      WHERE i.indrelid = pg_catalog.to_regclass('public.' || live)
    LOOP
      EXECUTE pg_catalog.format('ALTER INDEX public.%I RENAME TO %I', idx.relname,
        'rb_' || pg_catalog.left(pg_catalog.md5(idx.relname), 12) || '_' || pg_catalog.left(idx.relname, 44));
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
    REVOKE ALL ON TABLE public.artists_date_of_birth_rollback_backup
      FROM PUBLIC, anon, authenticated, service_role;
    INSERT INTO public.artists_date_of_birth_rollback_backup (artist_id, workspace_id, date_of_birth)
      SELECT id, workspace_id, date_of_birth FROM public.artists WHERE date_of_birth IS NOT NULL
      ON CONFLICT (artist_id) DO NOTHING;
    ALTER TABLE public.artists DROP CONSTRAINT IF EXISTS artists_date_of_birth_check;
    ALTER TABLE public.artists DROP COLUMN date_of_birth;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
      AND table_name = 'bookings' AND column_name = 'transport_to_city') THEN
    CREATE TABLE IF NOT EXISTS public.bookings_transport_to_city_rollback_backup (
      booking_id uuid PRIMARY KEY,
      workspace_id uuid NOT NULL,
      transport_to_city text NOT NULL,
      backed_up_at timestamptz NOT NULL DEFAULT pg_catalog.now()
    );
    ALTER TABLE public.bookings_transport_to_city_rollback_backup ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON TABLE public.bookings_transport_to_city_rollback_backup
      FROM PUBLIC, anon, authenticated, service_role;
    INSERT INTO public.bookings_transport_to_city_rollback_backup (booking_id, workspace_id, transport_to_city)
      SELECT id, workspace_id, transport_to_city FROM public.bookings WHERE transport_to_city IS NOT NULL
      ON CONFLICT (booking_id) DO NOTHING;
    ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_transport_to_city_check;
    ALTER TABLE public.bookings DROP COLUMN transport_to_city;
  END IF;
END
$park$;
NOTIFY pgrst, 'reload schema';
COMMIT;
