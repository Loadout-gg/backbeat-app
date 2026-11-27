-- Restore after a rollback of 009: run AFTER applying 009 again (same target setting).
-- Copies the parked rows back into the re-created tables (rows already present are kept), puts
-- date_of_birth and transport_to_city back where the value is still empty, then drops every
-- backup table. Audit rows come back with their original sequence, actor and time; nothing is
-- re-attributed (the card trigger does not audit writes without a session user).
-- Storage is not touched: a restored scan row is only as good as the object still in the bucket.
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
DECLARE
  cols text;
BEGIN
  IF pg_catalog.to_regclass('public.booking_travel_legs') IS NULL
     OR pg_catalog.to_regclass('public.booking_stays') IS NULL
     OR pg_catalog.to_regclass('public.artist_travel_documents') IS NULL
     OR pg_catalog.to_regclass('public.artist_travel_document_files') IS NULL
     OR pg_catalog.to_regclass('public.artist_travel_document_audit') IS NULL
     OR pg_catalog.to_regclass('public.artist_travel_document_relationships') IS NULL
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
       AND table_name = 'artists' AND column_name = 'date_of_birth')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
       AND table_name = 'bookings' AND column_name = 'transport_to_city') THEN
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
  IF pg_catalog.to_regclass('public.artist_travel_document_relationships_rollback_backup') IS NOT NULL THEN
    INSERT INTO public.artist_travel_document_relationships (workspace_id, artist_id, ended_at, updated_at)
    SELECT workspace_id, artist_id, ended_at, updated_at
    FROM public.artist_travel_document_relationships_rollback_backup
    ON CONFLICT (workspace_id, artist_id) DO NOTHING;
    DROP TABLE public.artist_travel_document_relationships_rollback_backup;
  END IF;
  -- Cards and scan versions reference each other: cards first without their current scan,
  -- then the versions, then the current-scan pointer. Both backups must be present together.
  IF (pg_catalog.to_regclass('public.artist_travel_documents_rollback_backup') IS NULL)
     <> (pg_catalog.to_regclass('public.artist_travel_document_files_rollback_backup') IS NULL) THEN
    RAISE EXCEPTION 'BOOKING_TRAVEL_RESTORE_BACKUP_INCOMPLETE';
  END IF;
  IF pg_catalog.to_regclass('public.artist_travel_documents_rollback_backup') IS NOT NULL THEN
    INSERT INTO public.artist_travel_documents (id, workspace_id, artist_id, doc_type, number,
      issuing_country, nationality, issued_on, expires_on, holder_name, state, generation,
      archived_at, restore_until, archive_cause, purged_at, created_at, updated_at)
    SELECT id, workspace_id, artist_id, doc_type, number,
      issuing_country, nationality, issued_on, expires_on, holder_name, state, generation,
      archived_at, restore_until, archive_cause, purged_at, created_at, updated_at
    FROM public.artist_travel_documents_rollback_backup
    ON CONFLICT (id) DO NOTHING;
    INSERT INTO public.artist_travel_document_files (id, workspace_id, artist_id, document_id,
      object_key, state, admitted, reserved_generation, media_type, byte_size, sha256, reject_reason,
      reserved_by, reserved_at, finalized_at, archived_at, restore_until, purged_at)
    SELECT id, workspace_id, artist_id, document_id,
      object_key, state, admitted, reserved_generation, media_type, byte_size, sha256, reject_reason,
      reserved_by, reserved_at, finalized_at, archived_at, restore_until, purged_at
    FROM public.artist_travel_document_files_rollback_backup
    ON CONFLICT (id) DO NOTHING;
    UPDATE public.artist_travel_documents AS d SET current_file_id = k.current_file_id
      FROM public.artist_travel_documents_rollback_backup AS k
      WHERE d.id = k.id AND d.current_file_id IS NULL AND k.current_file_id IS NOT NULL;
    DROP TABLE public.artist_travel_documents_rollback_backup,
      public.artist_travel_document_files_rollback_backup;
  END IF;
  IF pg_catalog.to_regclass('public.artist_travel_document_audit_rollback_backup') IS NOT NULL THEN
    cols := 'id, seq, workspace_id, artist_id, document_id, file_id, actor_id, action, detail, '
      || 'request_id, booking_id, event_id, document_generation, occurred_at';
    EXECUTE 'INSERT INTO public.artist_travel_document_audit (' || cols || ') OVERRIDING SYSTEM VALUE '
      || 'SELECT ' || cols || ' FROM public.artist_travel_document_audit_rollback_backup '
      || 'ON CONFLICT (id) DO NOTHING';
    PERFORM pg_catalog.setval(
      pg_catalog.pg_get_serial_sequence('public.artist_travel_document_audit', 'seq'),
      (SELECT coalesce(pg_catalog.max(seq), 0) + 1 FROM public.artist_travel_document_audit), false);
    -- Dropping the parked copy is not a change to an audit row: the rows now live in the table.
    DROP TABLE public.artist_travel_document_audit_rollback_backup;
  END IF;
  IF pg_catalog.to_regclass('public.artists_date_of_birth_rollback_backup') IS NOT NULL THEN
    UPDATE public.artists AS a SET date_of_birth = k.date_of_birth
      FROM public.artists_date_of_birth_rollback_backup AS k
      WHERE a.id = k.artist_id AND a.workspace_id = k.workspace_id AND a.date_of_birth IS NULL;
    DROP TABLE public.artists_date_of_birth_rollback_backup;
  END IF;
  IF pg_catalog.to_regclass('public.bookings_transport_to_city_rollback_backup') IS NOT NULL THEN
    UPDATE public.bookings AS b SET transport_to_city = k.transport_to_city
      FROM public.bookings_transport_to_city_rollback_backup AS k
      WHERE b.id = k.booking_id AND b.workspace_id = k.workspace_id AND b.transport_to_city IS NULL;
    DROP TABLE public.bookings_transport_to_city_rollback_backup;
  END IF;
END
$restore$;
NOTIFY pgrst, 'reload schema';
COMMIT;
