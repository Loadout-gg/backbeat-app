-- Restore after a rollback of 009: run AFTER applying 009 again (same target setting).
-- Copies the parked rows back into the re-created tables (rows already present are kept),
-- puts date_of_birth back on artists whose value is still empty, then drops every backup table.
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
DO $restore$
BEGIN
  IF pg_catalog.to_regclass('public.booking_travel_legs') IS NULL
     OR pg_catalog.to_regclass('public.booking_stays') IS NULL
     OR pg_catalog.to_regclass('public.artist_travel_documents') IS NULL
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
       AND table_name = 'artists' AND column_name = 'date_of_birth') THEN
    RAISE EXCEPTION 'BOOKING_TRAVEL_RESTORE_REQUIRES_009';
  END IF;
  IF pg_catalog.to_regclass('public.booking_travel_legs_rollback_backup') IS NOT NULL THEN
    INSERT INTO public.booking_travel_legs (id, workspace_id, booking_id, direction, mode, carrier,
      reference, depart_place, depart_date, depart_time, depart_zone, arrive_place, arrive_date,
      arrive_time, arrive_zone, travellers, driver_name, driver_phone, notes, created_at, updated_at)
    SELECT id, workspace_id, booking_id, direction, mode, carrier,
      reference, depart_place, depart_date, depart_time, depart_zone, arrive_place, arrive_date,
      arrive_time, arrive_zone, travellers, driver_name, driver_phone, notes, created_at, updated_at
    FROM public.booking_travel_legs_rollback_backup
    ON CONFLICT (id) DO NOTHING;
    DROP TABLE public.booking_travel_legs_rollback_backup;
  END IF;
  IF pg_catalog.to_regclass('public.booking_stays_rollback_backup') IS NOT NULL THEN
    INSERT INTO public.booking_stays (id, workspace_id, booking_id, name, address, check_in_on,
      check_out_on, confirmation_ref, notes, created_at, updated_at)
    SELECT id, workspace_id, booking_id, name, address, check_in_on,
      check_out_on, confirmation_ref, notes, created_at, updated_at
    FROM public.booking_stays_rollback_backup
    ON CONFLICT (id) DO NOTHING;
    DROP TABLE public.booking_stays_rollback_backup;
  END IF;
  IF pg_catalog.to_regclass('public.artist_travel_documents_rollback_backup') IS NOT NULL THEN
    INSERT INTO public.artist_travel_documents (id, workspace_id, artist_id, doc_type, number,
      issuing_country, expires_on, holder_name, created_at, updated_at)
    SELECT id, workspace_id, artist_id, doc_type, number,
      issuing_country, expires_on, holder_name, created_at, updated_at
    FROM public.artist_travel_documents_rollback_backup
    ON CONFLICT (id) DO NOTHING;
    DROP TABLE public.artist_travel_documents_rollback_backup;
  END IF;
  IF pg_catalog.to_regclass('public.artists_date_of_birth_rollback_backup') IS NOT NULL THEN
    UPDATE public.artists AS a SET date_of_birth = k.date_of_birth
      FROM public.artists_date_of_birth_rollback_backup AS k
      WHERE a.id = k.artist_id AND a.workspace_id = k.workspace_id AND a.date_of_birth IS NULL;
    DROP TABLE public.artists_date_of_birth_rollback_backup;
  END IF;
END
$restore$;
COMMIT;
