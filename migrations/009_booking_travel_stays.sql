-- P4 of ARCH-20261114-booking-domain r02, redesigned for Alberto's owner decision on PR #36
-- (comment "backbeat-travel-documents-owner-decision-12m-signed-v1", 2026-11-27, D1-D6) and
-- Simone's owner parameters of 2026-11-27. See docs/travel-documents.md.
-- Additive: booking_travel_legs, booking_stays (children of bookings); artist_travel_documents
-- (data cards), artist_travel_document_files (immutable scan versions),
-- artist_travel_document_audit (append-only), artist_travel_document_relationships (children of
-- artists); artists.date_of_birth; bookings.transport_to_city. No backfill; no row of an existing
-- table changes. NOT applied anywhere; applying it is Alberto's decision (exact bytes + target).
-- Storage bucket and Storage policies are NOT created here: ops/supabase/booking-travel/storage-provision.sql.
-- Travel documents and date of birth are sensitive personal data: read them only through the
-- explicit projections in lib/actions/booking-travel.ts and lib/actions/artist-travel-documents.ts.
-- SQLSTATE BB012-BB021 (006: BB001-BB003, 007: BB004-BB005, 010: BB006-BB007, 008: BB008-BB011).
-- Idempotent: safe to re-run. Requires 005. Prefix with an explicit target, in the same run:
--   SET backbeat.booking_travel_target = 'development';                 -- synthetic local
--   SET backbeat.booking_travel_target = 'hosted:hupkygptbvnzrihrlcxv'; -- staging
-- Each target must match its own synthetic marker row in public.runtime_environment;
-- production has no marker table. Production is not an allowed target of this file.
-- Rollback: ops/supabase/booking-travel/rollback.sql (see docs/booking-travel.md).
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
DO $requires$
BEGIN
  -- Same-workspace composite keys on both parents (bookings: migration 005; artists: 001).
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
      WHERE conrelid = 'public.bookings'::pg_catalog.regclass
        AND conname = 'bookings_workspace_id_id_key' AND contype = 'u') THEN
    RAISE EXCEPTION 'BOOKING_TRAVEL_REQUIRES_005';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint AS con
    WHERE con.conrelid = 'public.artists'::pg_catalog.regclass AND con.contype IN ('u', 'p')
      AND (SELECT pg_catalog.array_agg(att.attname::text ORDER BY att.attname::text)
           FROM pg_catalog.unnest(con.conkey) AS key(attnum)
           JOIN pg_catalog.pg_attribute AS att
             ON att.attrelid = con.conrelid AND att.attnum = key.attnum)
          = ARRAY['id', 'workspace_id']
  ) THEN
    RAISE EXCEPTION 'BOOKING_TRAVEL_REQUIRES_ARTIST_WORKSPACE_KEY';
  END IF;
  -- A rollback backup still in place means restore.sql has not run yet (see the rollback docs).
  IF pg_catalog.to_regclass('public.booking_travel_legs') IS NULL AND (
       pg_catalog.to_regclass('public.booking_travel_legs_rollback_backup') IS NOT NULL
    OR pg_catalog.to_regclass('public.booking_stays_rollback_backup') IS NOT NULL
    OR pg_catalog.to_regclass('public.artist_travel_documents_rollback_backup') IS NOT NULL
    OR pg_catalog.to_regclass('public.artist_travel_document_audit_rollback_backup') IS NOT NULL) THEN
    RAISE NOTICE 'BOOKING_TRAVEL_ROLLBACK_BACKUP_PRESENT: run restore.sql after this migration';
  END IF;
END
$requires$;

CREATE TABLE IF NOT EXISTS public.booking_travel_legs (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  booking_id uuid NOT NULL,
  direction text NOT NULL,
  mode text,
  carrier text,
  reference text,
  depart_place text,
  depart_date date,
  depart_time time,
  depart_zone text,
  arrive_place text,
  arrive_date date,
  arrive_time time,
  arrive_zone text,
  travellers text,
  driver_name text,
  driver_phone text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT booking_travel_legs_booking_fkey FOREIGN KEY (workspace_id, booking_id)
    REFERENCES public.bookings(workspace_id, id) ON DELETE CASCADE,
  CONSTRAINT booking_travel_legs_direction_check
    CHECK (direction IN ('inbound', 'outbound', 'other')),
  -- Local date + time per endpoint, no conversion (decision 2). A time needs its date.
  CONSTRAINT booking_travel_legs_depart_time_needs_date
    CHECK (depart_time IS NULL OR depart_date IS NOT NULL),
  CONSTRAINT booking_travel_legs_arrive_time_needs_date
    CHECK (arrive_time IS NULL OR arrive_date IS NOT NULL),
  -- Arrival not before departure. When both zone labels are set and differ (case and outer
  -- spaces ignored), local clocks are not comparable: the arrival date may be up to one day
  -- before the departure date (date-line crossing, e.g. Tokyo to Los Angeles) and times are not
  -- compared. With equal or missing labels: arrival date not before departure date and, on the
  -- same date, arrival time not before departure time.
  CONSTRAINT booking_travel_legs_order_check CHECK (
    depart_date IS NULL OR arrive_date IS NULL
    OR (pg_catalog.btrim(coalesce(depart_zone, '')) <> ''
        AND pg_catalog.btrim(coalesce(arrive_zone, '')) <> ''
        AND pg_catalog.lower(pg_catalog.btrim(depart_zone)) <> pg_catalog.lower(pg_catalog.btrim(arrive_zone))
        AND arrive_date >= depart_date - 1)
    OR arrive_date > depart_date
    OR (arrive_date = depart_date AND (
      depart_time IS NULL OR arrive_time IS NULL OR arrive_time >= depart_time))),
  CONSTRAINT booking_travel_legs_lengths CHECK (
    coalesce(pg_catalog.char_length(mode), 0) <= 50
    AND coalesce(pg_catalog.char_length(carrier), 0) <= 200
    AND coalesce(pg_catalog.char_length(reference), 0) <= 100
    AND coalesce(pg_catalog.char_length(depart_place), 0) <= 300
    AND coalesce(pg_catalog.char_length(arrive_place), 0) <= 300
    AND coalesce(pg_catalog.char_length(depart_zone), 0) <= 64
    AND coalesce(pg_catalog.char_length(arrive_zone), 0) <= 64
    AND coalesce(pg_catalog.char_length(travellers), 0) <= 1000
    AND coalesce(pg_catalog.char_length(driver_name), 0) <= 200
    AND coalesce(pg_catalog.char_length(driver_phone), 0) <= 100
    AND coalesce(pg_catalog.char_length(notes), 0) <= 2000)
);

CREATE TABLE IF NOT EXISTS public.booking_stays (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  booking_id uuid NOT NULL,
  name text NOT NULL,
  address text,
  check_in_on date,
  check_out_on date,
  confirmation_ref text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT booking_stays_booking_fkey FOREIGN KEY (workspace_id, booking_id)
    REFERENCES public.bookings(workspace_id, id) ON DELETE CASCADE,
  CONSTRAINT booking_stays_order_check
    CHECK (check_in_on IS NULL OR check_out_on IS NULL OR check_out_on >= check_in_on),
  CONSTRAINT booking_stays_lengths CHECK (
    pg_catalog.char_length(pg_catalog.btrim(name)) BETWEEN 1 AND 200
    AND coalesce(pg_catalog.char_length(address), 0) <= 1000
    AND coalesce(pg_catalog.char_length(confirmation_ref), 0) <= 100
    AND coalesce(pg_catalog.char_length(notes), 0) <= 2000)
);


-- Data card (D1, D4). Lifecycle (D5): active -> archived (recoverable until restore_until) ->
-- purge_pending (claimed by the operator purge, never restorable) -> purged (tombstone: every
-- document field NULL, ids and timestamps kept). generation changes on every lifecycle
-- transition and fences uploads and link issuance. Holder name = name as on the document;
-- nationality, issuing country, issue date and expiry are separate fields.
CREATE TABLE IF NOT EXISTS public.artist_travel_documents (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  artist_id uuid NOT NULL,
  doc_type text,
  number text,
  issuing_country text,
  nationality text,
  issued_on date,
  expires_on date,
  holder_name text,
  state text NOT NULL DEFAULT 'active',
  generation bigint NOT NULL DEFAULT 1,
  current_file_id uuid,
  archived_at timestamptz,
  restore_until timestamptz,
  archive_cause text,
  purged_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  -- CASCADE only ever removes purged tombstones: artist_travel_documents_protect refuses the rest.
  CONSTRAINT artist_travel_documents_artist_fkey FOREIGN KEY (workspace_id, artist_id)
    REFERENCES public.artists(workspace_id, id) ON DELETE CASCADE,
  CONSTRAINT artist_travel_documents_owner_key UNIQUE (workspace_id, artist_id, id),
  CONSTRAINT artist_travel_documents_doc_type_check
    CHECK (doc_type IN ('passport', 'id_card', 'other')),
  CONSTRAINT artist_travel_documents_state_check
    CHECK (state IN ('active', 'archived', 'purge_pending', 'purged')),
  CONSTRAINT artist_travel_documents_lifecycle_check CHECK (
    (state = 'active' AND archived_at IS NULL AND restore_until IS NULL
      AND archive_cause IS NULL AND purged_at IS NULL)
    OR (state IN ('archived', 'purge_pending') AND archived_at IS NOT NULL
      AND restore_until IS NOT NULL AND purged_at IS NULL
      AND archive_cause IN ('deleted', 'relationship_ended'))
    OR (state = 'purged' AND archived_at IS NOT NULL AND restore_until IS NOT NULL
      AND purged_at IS NOT NULL AND archive_cause IN ('deleted', 'relationship_ended'))),
  CONSTRAINT artist_travel_documents_data_check CHECK (
    (state = 'purged' AND doc_type IS NULL AND number IS NULL AND issuing_country IS NULL
      AND nationality IS NULL AND issued_on IS NULL AND expires_on IS NULL
      AND holder_name IS NULL AND current_file_id IS NULL)
    OR (state <> 'purged' AND doc_type IS NOT NULL AND number IS NOT NULL)),
  CONSTRAINT artist_travel_documents_lengths CHECK (
    (number IS NULL OR pg_catalog.char_length(pg_catalog.btrim(number)) BETWEEN 1 AND 64)
    AND coalesce(pg_catalog.char_length(issuing_country), 0) <= 100
    AND coalesce(pg_catalog.char_length(nationality), 0) <= 100
    AND coalesce(pg_catalog.char_length(holder_name), 0) <= 200)
);

-- One row per reserved scan version (D2, D5). The object key is allocated here, never chosen by
-- a browser and never rewritten. No read path returns it; the uploading browser sees it only
-- inside the one-time signed upload URL of its own reservation. pending = reserved, unservable; ready = validated on
-- observed bytes; restore_pending = card restored, bytes not yet re-verified; missing = bytes
-- absent or different at verification; superseded = replaced, kept privately until its own
-- restore_until; rejected = never admitted (invalid bytes or lost the lifecycle generation);
-- purge_pending / purged and cleanup_pending / cleaned = operator maintenance.
CREATE TABLE IF NOT EXISTS public.artist_travel_document_files (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  artist_id uuid NOT NULL,
  document_id uuid NOT NULL,
  object_key text NOT NULL,
  state text NOT NULL DEFAULT 'pending',
  admitted boolean NOT NULL DEFAULT false,
  reserved_generation bigint NOT NULL,
  media_type text,
  byte_size bigint,
  sha256 text,
  reject_reason text,
  reserved_by uuid NOT NULL,
  reserved_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  finalized_at timestamptz,
  archived_at timestamptz,
  restore_until timestamptz,
  purged_at timestamptz,
  CONSTRAINT artist_travel_document_files_document_fkey FOREIGN KEY (workspace_id, artist_id, document_id)
    REFERENCES public.artist_travel_documents(workspace_id, artist_id, id) ON DELETE CASCADE,
  CONSTRAINT artist_travel_document_files_owner_key UNIQUE (workspace_id, artist_id, document_id, id),
  CONSTRAINT artist_travel_document_files_object_key_key UNIQUE (object_key),
  CONSTRAINT artist_travel_document_files_object_key_check CHECK (
    pg_catalog.starts_with(object_key, workspace_id::text || '/' || artist_id::text || '/'
      || document_id::text || '/' || id::text || '/')
    AND pg_catalog.char_length(object_key) = 184),
  CONSTRAINT artist_travel_document_files_state_check CHECK (state IN ('pending', 'ready',
    'restore_pending', 'missing', 'superseded', 'rejected', 'purge_pending', 'purged',
    'cleanup_pending', 'cleaned')),
  CONSTRAINT artist_travel_document_files_bytes_check CHECK (
    (media_type IS NULL OR media_type IN ('application/pdf', 'image/jpeg', 'image/png', 'image/heic'))
    AND (byte_size IS NULL OR byte_size BETWEEN 1 AND 10485760)
    AND (sha256 IS NULL OR sha256 ~ '^[0-9a-f]{64}$')
    AND (reject_reason IS NULL OR reject_reason IN ('invalid_bytes', 'missing_bytes', 'lost_generation'))),
  -- Servable or recoverable states always carry the observed type, size and digest.
  CONSTRAINT artist_travel_document_files_admitted_check CHECK (
    (state IN ('ready', 'restore_pending', 'missing', 'superseded')
      AND admitted AND media_type IS NOT NULL AND byte_size IS NOT NULL AND sha256 IS NOT NULL)
    OR (state IN ('pending', 'rejected', 'cleanup_pending', 'cleaned') AND NOT admitted)
    OR (state IN ('purge_pending', 'purged') AND admitted)),
  CONSTRAINT artist_travel_document_files_superseded_check CHECK (
    state <> 'superseded' OR (archived_at IS NOT NULL AND restore_until IS NOT NULL))
);

-- The current scan of a card is always one of its own versions (same workspace, artist, card).
ALTER TABLE public.artist_travel_documents
  DROP CONSTRAINT IF EXISTS artist_travel_documents_current_file_fkey;
ALTER TABLE public.artist_travel_documents
  ADD CONSTRAINT artist_travel_documents_current_file_fkey
    FOREIGN KEY (workspace_id, artist_id, id, current_file_id)
    REFERENCES public.artist_travel_document_files(workspace_id, artist_id, document_id, id);

-- Automatic audit (D3). No foreign keys: a row is never rewritten or removed by a cascade and
-- outlives its card, file, artist and workspace. Written only by the functions below.
-- actor_id NULL = operator maintenance. detail is a fixed code, never free text or a reason.
CREATE TABLE IF NOT EXISTS public.artist_travel_document_audit (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  seq bigint GENERATED ALWAYS AS IDENTITY,
  workspace_id uuid NOT NULL,
  artist_id uuid NOT NULL,
  document_id uuid,
  file_id uuid,
  actor_id uuid,
  action text NOT NULL,
  detail text,
  request_id uuid,
  booking_id uuid,
  event_id uuid,
  document_generation bigint,
  occurred_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT artist_travel_document_audit_action_check CHECK (action IN (
    'card_created', 'card_updated', 'archived', 'restored', 'relationship_ended',
    'relationship_resumed', 'scan_upload_reserved', 'scan_uploaded', 'scan_replaced',
    'scan_rejected', 'scan_restore_verified', 'scan_restore_missing', 'download_authorized',
    'download_issued', 'download_not_issued', 'purge_claimed', 'file_purged', 'document_purged',
    'quarantine_cleaned')),
  CONSTRAINT artist_travel_document_audit_detail_check CHECK (detail IS NULL OR detail IN (
    'deleted', 'relationship_ended', 'invalid_bytes', 'missing_bytes', 'lost_generation',
    'signer_failed', 'membership_lost'))
);

-- Manual relationship signal (D5, owner parameter): a row exists once "End relationship" was
-- used; ended_at NULL = resumed. Not a contract subsystem.
CREATE TABLE IF NOT EXISTS public.artist_travel_document_relationships (
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  artist_id uuid NOT NULL,
  ended_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  PRIMARY KEY (workspace_id, artist_id),
  CONSTRAINT artist_travel_document_relationships_artist_fkey FOREIGN KEY (workspace_id, artist_id)
    REFERENCES public.artists(workspace_id, id) ON DELETE CASCADE
);

ALTER TABLE public.artists ADD COLUMN IF NOT EXISTS date_of_birth date;
ALTER TABLE public.artists DROP CONSTRAINT IF EXISTS artists_date_of_birth_check;
ALTER TABLE public.artists
  ADD CONSTRAINT artists_date_of_birth_check
    CHECK (date_of_birth IS NULL OR date_of_birth >= DATE '1900-01-01');

-- D6: who organizes and pays travel to the venue city; one field, independent of leg modes.
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS transport_to_city text;
ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_transport_to_city_check;
ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_transport_to_city_check
    CHECK (transport_to_city IS NULL OR transport_to_city IN ('promoter', 'artist', 'not_needed'));

-- A re-run must not silently accept a table of the same name with another shape.
DO $shape$
BEGIN
  IF (SELECT pg_catalog.count(*) FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'booking_travel_legs') <> 21
     OR (SELECT pg_catalog.count(*) FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'booking_stays') <> 11
     OR (SELECT pg_catalog.count(*) FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'artist_travel_documents') <> 19
     OR (SELECT pg_catalog.count(*) FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'artist_travel_document_files') <> 18
     OR (SELECT pg_catalog.count(*) FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'artist_travel_document_audit') <> 14
     OR (SELECT pg_catalog.count(*) FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'artist_travel_document_relationships') <> 4
     OR (SELECT pg_catalog.count(*) FROM pg_catalog.pg_constraint
      WHERE contype = 'f' AND (conrelid, conname) IN (
        ('public.booking_travel_legs'::pg_catalog.regclass, 'booking_travel_legs_booking_fkey'),
        ('public.booking_stays'::pg_catalog.regclass, 'booking_stays_booking_fkey'),
        ('public.artist_travel_documents'::pg_catalog.regclass, 'artist_travel_documents_artist_fkey'),
        ('public.artist_travel_documents'::pg_catalog.regclass, 'artist_travel_documents_current_file_fkey'),
        ('public.artist_travel_document_files'::pg_catalog.regclass, 'artist_travel_document_files_document_fkey'),
        ('public.artist_travel_document_relationships'::pg_catalog.regclass, 'artist_travel_document_relationships_artist_fkey'))) <> 6
     -- The audit table must stay free of foreign keys (no CASCADE / SET NULL rewrite).
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE contype = 'f'
      AND conrelid = 'public.artist_travel_document_audit'::pg_catalog.regclass) THEN
    RAISE EXCEPTION 'BOOKING_TRAVEL_EXISTING_TABLE_SHAPE_MISMATCH';
  END IF;
END
$shape$;

CREATE INDEX IF NOT EXISTS booking_travel_legs_workspace_booking_idx
  ON public.booking_travel_legs (workspace_id, booking_id);
CREATE INDEX IF NOT EXISTS booking_stays_workspace_booking_idx
  ON public.booking_stays (workspace_id, booking_id);
CREATE INDEX IF NOT EXISTS artist_travel_documents_workspace_artist_idx
  ON public.artist_travel_documents (workspace_id, artist_id);
CREATE INDEX IF NOT EXISTS artist_travel_documents_due_idx
  ON public.artist_travel_documents (restore_until) WHERE state = 'archived';
CREATE INDEX IF NOT EXISTS artist_travel_document_files_document_idx
  ON public.artist_travel_document_files (document_id);
CREATE INDEX IF NOT EXISTS artist_travel_document_files_maintenance_idx
  ON public.artist_travel_document_files (state)
  WHERE state IN ('pending', 'rejected', 'superseded', 'purge_pending', 'cleanup_pending');
CREATE INDEX IF NOT EXISTS artist_travel_document_audit_scope_idx
  ON public.artist_travel_document_audit (workspace_id, artist_id, seq);
CREATE INDEX IF NOT EXISTS artist_travel_document_audit_occurred_idx
  ON public.artist_travel_document_audit (occurred_at);
-- One authorization and at most one outcome per issuance request: a replay is refused.
CREATE UNIQUE INDEX IF NOT EXISTS artist_travel_document_audit_authorized_key
  ON public.artist_travel_document_audit (request_id) WHERE action = 'download_authorized';
CREATE UNIQUE INDEX IF NOT EXISTS artist_travel_document_audit_outcome_key
  ON public.artist_travel_document_audit (request_id)
  WHERE action IN ('download_issued', 'download_not_issued');

-- ---------------------------------------------------------------------------------------------
-- Internal helpers. EXECUTE is revoked from every API role: only the SECURITY DEFINER functions
-- and triggers of this file (running as their owner) reach them.
-- ---------------------------------------------------------------------------------------------

-- Recovery cutoff (D5): archive instant + 12 calendar months in UTC, same time of day, day
-- clamped to the last day of the target month. Stored once per archive episode.
CREATE OR REPLACE FUNCTION public.backbeat_travel_document_cutoff(archived timestamptz)
RETURNS timestamptz LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$
  SELECT ((archived AT TIME ZONE 'UTC') + INTERVAL '12 months') AT TIME ZONE 'UTC';
$$;

CREATE OR REPLACE FUNCTION public.backbeat_travel_document_is_member(actor uuid, target_workspace uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT actor IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.workspace_members AS m
    WHERE m.workspace_id = target_workspace AND m.user_id = actor AND m.status = 'active');
$$;

-- The only writer of the audit table. Timestamp and sequence come from the database.
CREATE OR REPLACE FUNCTION public.backbeat_travel_document_audit_write(
  p_workspace_id uuid, p_artist_id uuid, p_document_id uuid, p_file_id uuid, p_actor uuid,
  p_action text, p_detail text DEFAULT NULL, p_generation bigint DEFAULT NULL,
  p_request_id uuid DEFAULT NULL, p_booking_id uuid DEFAULT NULL, p_event_id uuid DEFAULT NULL)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $$
  INSERT INTO public.artist_travel_document_audit (workspace_id, artist_id, document_id, file_id,
    actor_id, action, detail, document_generation, request_id, booking_id, event_id)
  VALUES (p_workspace_id, p_artist_id, p_document_id, p_file_id, p_actor, p_action, p_detail,
    p_generation, p_request_id, p_booking_id, p_event_id);
$$;

-- One authoritative archive transition for a locked, active card. The current scan stays bound
-- to the card and is denied by the card state; Storage is never called.
CREATE OR REPLACE FUNCTION public.backbeat_travel_document_archive_row(
  p_document_id uuid, p_cause text, p_actor uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  doc public.artist_travel_documents%ROWTYPE;
BEGIN
  UPDATE public.artist_travel_documents
    SET state = 'archived', archived_at = pg_catalog.now(),
        restore_until = public.backbeat_travel_document_cutoff(pg_catalog.now()),
        archive_cause = p_cause, generation = generation + 1, updated_at = pg_catalog.now()
    WHERE id = p_document_id AND state = 'active'
    RETURNING * INTO doc;
  IF NOT FOUND THEN RETURN; END IF;
  PERFORM public.backbeat_travel_document_audit_write(doc.workspace_id, doc.artist_id, doc.id,
    doc.current_file_id, p_actor, 'archived', p_cause, doc.generation);
END
$$;

-- Final scrub of a claimed card once none of its objects is still pending removal.
CREATE OR REPLACE FUNCTION public.backbeat_travel_document_scrub(p_document_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  doc public.artist_travel_documents%ROWTYPE;
BEGIN
  SELECT * INTO doc FROM public.artist_travel_documents WHERE id = p_document_id FOR UPDATE;
  IF NOT FOUND OR doc.state <> 'purge_pending' OR EXISTS (
    SELECT 1 FROM public.artist_travel_document_files
    WHERE document_id = p_document_id AND state = 'purge_pending') THEN
    RETURN false;
  END IF;
  UPDATE public.artist_travel_documents
    SET state = 'purged', purged_at = pg_catalog.now(), doc_type = NULL, number = NULL,
        issuing_country = NULL, nationality = NULL, issued_on = NULL, expires_on = NULL,
        holder_name = NULL, current_file_id = NULL, generation = generation + 1,
        updated_at = pg_catalog.now()
    WHERE id = p_document_id;
  PERFORM public.backbeat_travel_document_audit_write(doc.workspace_id, doc.artist_id, doc.id,
    NULL, NULL, 'document_purged', NULL, doc.generation + 1);
  RETURN true;
END
$$;

-- ---------------------------------------------------------------------------------------------
-- Triggers.
-- ---------------------------------------------------------------------------------------------

-- BB012: audit rows are append-only. UPDATE and TRUNCATE are always refused; DELETE passes only
-- inside backbeat_travel_document_audit_retention_purge (transaction-local marker set there).
CREATE OR REPLACE FUNCTION public.backbeat_travel_document_audit_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE'
     AND pg_catalog.current_setting('backbeat.travel_audit_retention', true) = 'purge' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'TRAVEL_DOCUMENT_AUDIT_IS_APPEND_ONLY' USING ERRCODE = 'BB012';
END
$$;
DROP TRIGGER IF EXISTS artist_travel_document_audit_append_only ON public.artist_travel_document_audit;
CREATE TRIGGER artist_travel_document_audit_append_only
  BEFORE UPDATE OR DELETE ON public.artist_travel_document_audit
  FOR EACH ROW EXECUTE FUNCTION public.backbeat_travel_document_audit_guard();
DROP TRIGGER IF EXISTS artist_travel_document_audit_no_truncate ON public.artist_travel_document_audit;
CREATE TRIGGER artist_travel_document_audit_no_truncate
  BEFORE TRUNCATE ON public.artist_travel_document_audit
  FOR EACH STATEMENT EXECUTE FUNCTION public.backbeat_travel_document_audit_guard();

-- BB018: no direct or cascaded delete destroys a card or a tracked object key. Only purged
-- tombstones and purged / cleaned file rows may go (with their artist or workspace).
CREATE OR REPLACE FUNCTION public.backbeat_travel_document_protect()
RETURNS trigger LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN
  IF (TG_TABLE_NAME = 'artist_travel_documents' AND OLD.state = 'purged')
     OR (TG_TABLE_NAME = 'artist_travel_document_files' AND OLD.state IN ('purged', 'cleaned')) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'TRAVEL_DOCUMENT_DELETE_IS_PROTECTED' USING ERRCODE = 'BB018';
END
$$;
DROP TRIGGER IF EXISTS artist_travel_documents_protect ON public.artist_travel_documents;
CREATE TRIGGER artist_travel_documents_protect
  BEFORE DELETE ON public.artist_travel_documents
  FOR EACH ROW EXECUTE FUNCTION public.backbeat_travel_document_protect();
DROP TRIGGER IF EXISTS artist_travel_document_files_protect ON public.artist_travel_document_files;
CREATE TRIGGER artist_travel_document_files_protect
  BEFORE DELETE ON public.artist_travel_document_files
  FOR EACH ROW EXECUTE FUNCTION public.backbeat_travel_document_protect();

-- Card writes by a member: BB019 while the relationship is ended (serialized with "End
-- relationship" through the artist row lock), then one automatic audit row per real change.
-- Writes without a session user (SQL editor, restore.sql) are not attributed and not audited.
CREATE OR REPLACE FUNCTION public.backbeat_travel_document_card_audit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' AND TG_WHEN = 'BEFORE' THEN
    -- A session that is not an active member learns nothing here: the INSERT policy refuses it.
    IF NEW.state = 'active' AND (auth.uid() IS NULL
        OR public.backbeat_travel_document_is_member(auth.uid(), NEW.workspace_id)) THEN
      PERFORM 1 FROM public.artists
        WHERE id = NEW.artist_id AND workspace_id = NEW.workspace_id FOR KEY SHARE;
      IF EXISTS (SELECT 1 FROM public.artist_travel_document_relationships
          WHERE workspace_id = NEW.workspace_id AND artist_id = NEW.artist_id
            AND ended_at IS NOT NULL) THEN
        RAISE EXCEPTION 'TRAVEL_DOCUMENT_RELATIONSHIP_ENDED' USING ERRCODE = 'BB019';
      END IF;
    END IF;
    RETURN NEW;
  END IF;
  IF auth.uid() IS NULL THEN RETURN NULL; END IF;
  IF TG_OP = 'INSERT' THEN
    PERFORM public.backbeat_travel_document_audit_write(NEW.workspace_id, NEW.artist_id, NEW.id,
      NULL, auth.uid(), 'card_created', NULL, NEW.generation);
  ELSIF OLD.state = 'active' AND NEW.state = 'active' AND (
       NEW.doc_type IS DISTINCT FROM OLD.doc_type OR NEW.number IS DISTINCT FROM OLD.number
    OR NEW.issuing_country IS DISTINCT FROM OLD.issuing_country
    OR NEW.nationality IS DISTINCT FROM OLD.nationality
    OR NEW.issued_on IS DISTINCT FROM OLD.issued_on OR NEW.expires_on IS DISTINCT FROM OLD.expires_on
    OR NEW.holder_name IS DISTINCT FROM OLD.holder_name) THEN
    PERFORM public.backbeat_travel_document_audit_write(NEW.workspace_id, NEW.artist_id, NEW.id,
      NEW.current_file_id, auth.uid(), 'card_updated', NULL, NEW.generation);
  END IF;
  RETURN NULL;
END
$$;
DROP TRIGGER IF EXISTS artist_travel_documents_relationship ON public.artist_travel_documents;
CREATE TRIGGER artist_travel_documents_relationship
  BEFORE INSERT ON public.artist_travel_documents
  FOR EACH ROW EXECUTE FUNCTION public.backbeat_travel_document_card_audit();
DROP TRIGGER IF EXISTS artist_travel_documents_audit ON public.artist_travel_documents;
CREATE TRIGGER artist_travel_documents_audit
  AFTER INSERT OR UPDATE ON public.artist_travel_documents
  FOR EACH ROW EXECUTE FUNCTION public.backbeat_travel_document_card_audit();

-- ---------------------------------------------------------------------------------------------
-- Member entry points (EXECUTE: authenticated). The actor is auth.uid(), never a parameter.
-- Unknown card, other workspace and non-member all answer BB014.
-- ---------------------------------------------------------------------------------------------

-- Recoverable delete. A repeat, or a card archived earlier, changes nothing (same cutoff).
CREATE OR REPLACE FUNCTION public.backbeat_travel_document_archive(p_workspace_id uuid, p_document_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  doc public.artist_travel_documents%ROWTYPE;
BEGIN
  IF NOT public.backbeat_travel_document_is_member(auth.uid(), p_workspace_id) THEN
    RAISE EXCEPTION 'TRAVEL_DOCUMENT_NOT_FOUND' USING ERRCODE = 'BB014';
  END IF;
  SELECT * INTO doc FROM public.artist_travel_documents
    WHERE id = p_document_id AND workspace_id = p_workspace_id FOR UPDATE;
  IF NOT FOUND OR doc.state = 'purged' THEN
    RAISE EXCEPTION 'TRAVEL_DOCUMENT_NOT_FOUND' USING ERRCODE = 'BB014';
  END IF;
  IF doc.state <> 'active' THEN RETURN 'already_archived'; END IF;
  PERFORM public.backbeat_travel_document_archive_row(doc.id, 'deleted', auth.uid());
  RETURN 'archived';
END
$$;

-- Recovery, distinct from ordinary access. Wins only strictly before the stored cutoff and only
-- while the card is 'archived' (a purge claim makes it ineligible: BB016). The card keeps its id,
-- artist and workspace; its scan becomes servable again only after the bytes are re-verified.
CREATE OR REPLACE FUNCTION public.backbeat_travel_document_restore(p_workspace_id uuid, p_document_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  doc public.artist_travel_documents%ROWTYPE;
BEGIN
  IF NOT public.backbeat_travel_document_is_member(auth.uid(), p_workspace_id) THEN
    RAISE EXCEPTION 'TRAVEL_DOCUMENT_NOT_FOUND' USING ERRCODE = 'BB014';
  END IF;
  SELECT * INTO doc FROM public.artist_travel_documents
    WHERE id = p_document_id AND workspace_id = p_workspace_id FOR UPDATE;
  IF NOT FOUND OR doc.state = 'purged' THEN
    RAISE EXCEPTION 'TRAVEL_DOCUMENT_NOT_FOUND' USING ERRCODE = 'BB014';
  END IF;
  IF doc.state = 'active' THEN RETURN 'already_active'; END IF;
  IF doc.state <> 'archived' OR NOT (pg_catalog.now() < doc.restore_until) THEN
    RAISE EXCEPTION 'TRAVEL_DOCUMENT_RESTORE_WINDOW_CLOSED' USING ERRCODE = 'BB016';
  END IF;
  PERFORM 1 FROM public.artists
    WHERE id = doc.artist_id AND workspace_id = doc.workspace_id FOR KEY SHARE;
  IF EXISTS (SELECT 1 FROM public.artist_travel_document_relationships
      WHERE workspace_id = doc.workspace_id AND artist_id = doc.artist_id AND ended_at IS NOT NULL) THEN
    RAISE EXCEPTION 'TRAVEL_DOCUMENT_RELATIONSHIP_ENDED' USING ERRCODE = 'BB019';
  END IF;
  UPDATE public.artist_travel_documents
    SET state = 'active', archived_at = NULL, restore_until = NULL, archive_cause = NULL,
        generation = generation + 1, updated_at = pg_catalog.now()
    WHERE id = doc.id;
  UPDATE public.artist_travel_document_files SET state = 'restore_pending'
    WHERE id = doc.current_file_id AND state = 'ready';
  PERFORM public.backbeat_travel_document_audit_write(doc.workspace_id, doc.artist_id, doc.id,
    doc.current_file_id, auth.uid(), 'restored', NULL, doc.generation + 1);
  RETURN 'restored';
END
$$;

-- "End relationship": archives every active card of the artist in one transaction and starts
-- their 12-month episodes. Cards archived earlier keep their original cutoff. A repeat is a no-op.
CREATE OR REPLACE FUNCTION public.backbeat_travel_document_relationship_end(p_workspace_id uuid, p_artist_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  doc_id uuid;
  archived integer := 0;
BEGIN
  IF NOT public.backbeat_travel_document_is_member(auth.uid(), p_workspace_id) THEN
    RAISE EXCEPTION 'TRAVEL_DOCUMENT_NOT_FOUND' USING ERRCODE = 'BB014';
  END IF;
  PERFORM 1 FROM public.artists WHERE id = p_artist_id AND workspace_id = p_workspace_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TRAVEL_DOCUMENT_NOT_FOUND' USING ERRCODE = 'BB014';
  END IF;
  IF EXISTS (SELECT 1 FROM public.artist_travel_document_relationships
      WHERE workspace_id = p_workspace_id AND artist_id = p_artist_id AND ended_at IS NOT NULL) THEN
    RETURN 0;
  END IF;
  INSERT INTO public.artist_travel_document_relationships (workspace_id, artist_id, ended_at)
    VALUES (p_workspace_id, p_artist_id, pg_catalog.now())
    ON CONFLICT (workspace_id, artist_id)
    DO UPDATE SET ended_at = pg_catalog.now(), updated_at = pg_catalog.now();
  PERFORM public.backbeat_travel_document_audit_write(p_workspace_id, p_artist_id, NULL, NULL,
    auth.uid(), 'relationship_ended');
  FOR doc_id IN
    SELECT id FROM public.artist_travel_documents
    WHERE workspace_id = p_workspace_id AND artist_id = p_artist_id AND state = 'active'
    ORDER BY id FOR UPDATE
  LOOP
    PERFORM public.backbeat_travel_document_archive_row(doc_id, 'relationship_ended', auth.uid());
    archived := archived + 1;
  END LOOP;
  RETURN archived;
END
$$;

-- "Resume relationship": re-enables per-card restore inside each card's own window and new
-- cards. Nothing is restored or republished automatically; no cutoff moves.
CREATE OR REPLACE FUNCTION public.backbeat_travel_document_relationship_resume(p_workspace_id uuid, p_artist_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NOT public.backbeat_travel_document_is_member(auth.uid(), p_workspace_id) THEN
    RAISE EXCEPTION 'TRAVEL_DOCUMENT_NOT_FOUND' USING ERRCODE = 'BB014';
  END IF;
  PERFORM 1 FROM public.artists WHERE id = p_artist_id AND workspace_id = p_workspace_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TRAVEL_DOCUMENT_NOT_FOUND' USING ERRCODE = 'BB014';
  END IF;
  UPDATE public.artist_travel_document_relationships
    SET ended_at = NULL, updated_at = pg_catalog.now()
    WHERE workspace_id = p_workspace_id AND artist_id = p_artist_id AND ended_at IS NOT NULL;
  IF NOT FOUND THEN RETURN false; END IF;
  PERFORM public.backbeat_travel_document_audit_write(p_workspace_id, p_artist_id, NULL, NULL,
    auth.uid(), 'relationship_resumed');
  RETURN true;
END
$$;

-- ---------------------------------------------------------------------------------------------
-- Trusted server path (EXECUTE: service_role only; not callable from a browser session).
-- p_actor is the user the server verified from the session; membership is re-read here, in the
-- same transaction as the audit row. BB013 = actor is not an active member of the workspace.
-- ---------------------------------------------------------------------------------------------

-- Reserve a new private key for a pending, unservable version of an active card.
CREATE OR REPLACE FUNCTION public.backbeat_travel_document_reserve_upload(
  p_actor uuid, p_workspace_id uuid, p_document_id uuid)
RETURNS TABLE (file_id uuid, object_key text) LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  doc public.artist_travel_documents%ROWTYPE;
  new_id uuid := pg_catalog.gen_random_uuid();
  new_key text;
BEGIN
  IF NOT public.backbeat_travel_document_is_member(p_actor, p_workspace_id) THEN
    RAISE EXCEPTION 'TRAVEL_DOCUMENT_ACTOR_NOT_MEMBER' USING ERRCODE = 'BB013';
  END IF;
  SELECT * INTO doc FROM public.artist_travel_documents
    WHERE id = p_document_id AND workspace_id = p_workspace_id FOR SHARE;
  IF NOT FOUND OR doc.state = 'purged' THEN
    RAISE EXCEPTION 'TRAVEL_DOCUMENT_NOT_FOUND' USING ERRCODE = 'BB014';
  END IF;
  IF doc.state <> 'active' THEN
    RAISE EXCEPTION 'TRAVEL_DOCUMENT_STATE_NOT_ALLOWED' USING ERRCODE = 'BB015';
  END IF;
  new_key := doc.workspace_id::text || '/' || doc.artist_id::text || '/' || doc.id::text || '/'
    || new_id::text || '/' || pg_catalog.gen_random_uuid()::text;
  INSERT INTO public.artist_travel_document_files (id, workspace_id, artist_id, document_id,
      object_key, reserved_generation, reserved_by)
    VALUES (new_id, doc.workspace_id, doc.artist_id, doc.id, new_key, doc.generation, p_actor);
  PERFORM public.backbeat_travel_document_audit_write(doc.workspace_id, doc.artist_id, doc.id,
    new_id, p_actor, 'scan_upload_reserved', NULL, doc.generation);
  RETURN QUERY SELECT new_id, new_key;
END
$$;

-- Key of a pending reservation, for the server-side byte validation that precedes finalize.
CREATE OR REPLACE FUNCTION public.backbeat_travel_document_pending_key(
  p_actor uuid, p_workspace_id uuid, p_file_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  file public.artist_travel_document_files%ROWTYPE;
BEGIN
  IF NOT public.backbeat_travel_document_is_member(p_actor, p_workspace_id) THEN
    RAISE EXCEPTION 'TRAVEL_DOCUMENT_ACTOR_NOT_MEMBER' USING ERRCODE = 'BB013';
  END IF;
  SELECT * INTO file FROM public.artist_travel_document_files
    WHERE id = p_file_id AND workspace_id = p_workspace_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TRAVEL_DOCUMENT_NOT_FOUND' USING ERRCODE = 'BB014';
  END IF;
  IF file.state <> 'pending' THEN
    RAISE EXCEPTION 'TRAVEL_DOCUMENT_STATE_NOT_ALLOWED' USING ERRCODE = 'BB015';
  END IF;
  RETURN file.object_key;
END
$$;

-- Publish a validated version, serialized with archive / restore through the card row lock.
-- Archive first: the card is no longer active at the reserved generation, the version is
-- rejected (lost_generation) and stays inventoried. Finalize first: the version is current and
-- a later archive includes it. The displaced version is kept privately as 'superseded' with its
-- own 12-month cutoff. p_reject_reason set = the server found no valid bytes.
CREATE OR REPLACE FUNCTION public.backbeat_travel_document_finalize_upload(
  p_actor uuid, p_workspace_id uuid, p_file_id uuid, p_media_type text, p_byte_size bigint,
  p_sha256 text, p_reject_reason text DEFAULT NULL)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  file public.artist_travel_document_files%ROWTYPE;
  doc public.artist_travel_documents%ROWTYPE;
  rejection text := p_reject_reason;
BEGIN
  IF NOT public.backbeat_travel_document_is_member(p_actor, p_workspace_id) THEN
    RAISE EXCEPTION 'TRAVEL_DOCUMENT_ACTOR_NOT_MEMBER' USING ERRCODE = 'BB013';
  END IF;
  SELECT * INTO file FROM public.artist_travel_document_files
    WHERE id = p_file_id AND workspace_id = p_workspace_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TRAVEL_DOCUMENT_NOT_FOUND' USING ERRCODE = 'BB014';
  END IF;
  SELECT * INTO doc FROM public.artist_travel_documents WHERE id = file.document_id FOR UPDATE;
  SELECT * INTO file FROM public.artist_travel_document_files WHERE id = p_file_id FOR UPDATE;
  IF file.state <> 'pending' THEN
    RAISE EXCEPTION 'TRAVEL_DOCUMENT_STATE_NOT_ALLOWED' USING ERRCODE = 'BB015';
  END IF;
  IF rejection IS NULL AND (doc.state <> 'active' OR doc.generation <> file.reserved_generation) THEN
    rejection := 'lost_generation';
  END IF;
  IF rejection IS NOT NULL THEN
    UPDATE public.artist_travel_document_files
      SET state = 'rejected', reject_reason = rejection, finalized_at = pg_catalog.now()
      WHERE id = file.id;
    PERFORM public.backbeat_travel_document_audit_write(doc.workspace_id, doc.artist_id, doc.id,
      file.id, p_actor, 'scan_rejected', rejection, doc.generation);
    RETURN 'rejected';
  END IF;
  UPDATE public.artist_travel_document_files
    SET state = 'ready', admitted = true, media_type = p_media_type, byte_size = p_byte_size,
        sha256 = p_sha256, finalized_at = pg_catalog.now()
    WHERE id = file.id;
  UPDATE public.artist_travel_document_files
    SET state = 'superseded', archived_at = pg_catalog.now(),
        restore_until = public.backbeat_travel_document_cutoff(pg_catalog.now())
    WHERE id = doc.current_file_id AND state IN ('ready', 'restore_pending', 'missing');
  UPDATE public.artist_travel_documents
    SET current_file_id = file.id, updated_at = pg_catalog.now() WHERE id = doc.id;
  PERFORM public.backbeat_travel_document_audit_write(doc.workspace_id, doc.artist_id, doc.id,
    file.id, p_actor,
    CASE WHEN doc.current_file_id IS NULL THEN 'scan_uploaded' ELSE 'scan_replaced' END,
    NULL, doc.generation);
  RETURN 'ready';
END
$$;

-- Authorization boundary of a download (D2, D3): live membership, canonical binding
-- (workspace -> artist -> active card -> its current ready version) and optional booking / event
-- context are checked and the automatic event is written in ONE transaction; the caller signs only
-- after this call has committed. No Storage key, TTL or reason comes from the browser.
-- BB017 = context is not a booking / event of this workspace and artist. BB020 = scan of a
-- restored card whose bytes are not verified yet.
CREATE OR REPLACE FUNCTION public.backbeat_travel_document_authorize_download(
  p_actor uuid, p_workspace_id uuid, p_file_id uuid, p_request_id uuid,
  p_booking_id uuid DEFAULT NULL, p_event_id uuid DEFAULT NULL)
RETURNS TABLE (object_key text, document_generation bigint, media_type text, doc_type text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  file public.artist_travel_document_files%ROWTYPE;
  doc public.artist_travel_documents%ROWTYPE;
BEGIN
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'TRAVEL_DOCUMENT_STATE_NOT_ALLOWED' USING ERRCODE = 'BB015';
  END IF;
  IF NOT public.backbeat_travel_document_is_member(p_actor, p_workspace_id) THEN
    RAISE EXCEPTION 'TRAVEL_DOCUMENT_ACTOR_NOT_MEMBER' USING ERRCODE = 'BB013';
  END IF;
  SELECT * INTO file FROM public.artist_travel_document_files
    WHERE id = p_file_id AND workspace_id = p_workspace_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TRAVEL_DOCUMENT_NOT_FOUND' USING ERRCODE = 'BB014';
  END IF;
  SELECT * INTO doc FROM public.artist_travel_documents WHERE id = file.document_id FOR SHARE;
  SELECT * INTO file FROM public.artist_travel_document_files WHERE id = p_file_id FOR SHARE;
  IF doc.state <> 'active' OR doc.current_file_id IS DISTINCT FROM file.id THEN
    RAISE EXCEPTION 'TRAVEL_DOCUMENT_STATE_NOT_ALLOWED' USING ERRCODE = 'BB015';
  END IF;
  IF file.state IN ('restore_pending', 'missing') THEN
    RAISE EXCEPTION 'TRAVEL_DOCUMENT_BYTES_NOT_VERIFIED' USING ERRCODE = 'BB020';
  END IF;
  IF file.state <> 'ready' THEN
    RAISE EXCEPTION 'TRAVEL_DOCUMENT_STATE_NOT_ALLOWED' USING ERRCODE = 'BB015';
  END IF;
  IF p_booking_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.bookings AS b
      WHERE b.id = p_booking_id AND b.workspace_id = doc.workspace_id AND b.artist_id = doc.artist_id) THEN
    RAISE EXCEPTION 'TRAVEL_DOCUMENT_CONTEXT_INVALID' USING ERRCODE = 'BB017';
  END IF;
  IF p_event_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.events AS e
      WHERE e.id = p_event_id AND e.workspace_id = doc.workspace_id AND e.artist_id = doc.artist_id) THEN
    RAISE EXCEPTION 'TRAVEL_DOCUMENT_CONTEXT_INVALID' USING ERRCODE = 'BB017';
  END IF;
  BEGIN
    PERFORM public.backbeat_travel_document_audit_write(doc.workspace_id, doc.artist_id, doc.id,
      file.id, p_actor, 'download_authorized', NULL, doc.generation, p_request_id, p_booking_id,
      p_event_id);
  EXCEPTION WHEN unique_violation THEN
    -- A request id is single use: a replay is never a fresh grant.
    RAISE EXCEPTION 'TRAVEL_DOCUMENT_STATE_NOT_ALLOWED' USING ERRCODE = 'BB015';
  END;
  RETURN QUERY SELECT file.object_key, doc.generation, file.media_type, doc.doc_type;
END
$$;

-- Lifecycle fence and outcome record, called after the signer answered and before the link is
-- released. Returns true only when the signer succeeded AND the actor is still a member AND the
-- card is still active at the authorized generation with this version current and ready. The
-- outcome is a new row; the authorization row is never changed. No outcome row = unknown.
CREATE OR REPLACE FUNCTION public.backbeat_travel_document_record_issuance(
  p_actor uuid, p_workspace_id uuid, p_file_id uuid, p_request_id uuid, p_generation bigint,
  p_signed boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  granted public.artist_travel_document_audit%ROWTYPE;
  doc public.artist_travel_documents%ROWTYPE;
  file_state text;
  refusal text;
BEGIN
  SELECT * INTO granted FROM public.artist_travel_document_audit
    WHERE request_id = p_request_id AND action = 'download_authorized'
      AND actor_id = p_actor AND file_id = p_file_id AND workspace_id = p_workspace_id
      AND document_generation = p_generation;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TRAVEL_DOCUMENT_NOT_FOUND' USING ERRCODE = 'BB014';
  END IF;
  SELECT * INTO doc FROM public.artist_travel_documents WHERE id = granted.document_id FOR SHARE;
  SELECT state INTO file_state FROM public.artist_travel_document_files WHERE id = p_file_id FOR SHARE;
  IF p_signed IS NOT TRUE THEN
    refusal := 'signer_failed';
  ELSIF NOT public.backbeat_travel_document_is_member(p_actor, p_workspace_id) THEN
    refusal := 'membership_lost';
  ELSIF doc.state <> 'active' OR doc.generation <> p_generation
     OR doc.current_file_id IS DISTINCT FROM p_file_id OR file_state IS DISTINCT FROM 'ready' THEN
    refusal := 'lost_generation';
  END IF;
  BEGIN
    PERFORM public.backbeat_travel_document_audit_write(granted.workspace_id, granted.artist_id,
      granted.document_id, granted.file_id, p_actor,
      CASE WHEN refusal IS NULL THEN 'download_issued' ELSE 'download_not_issued' END,
      refusal, doc.generation, p_request_id, granted.booking_id, granted.event_id);
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'TRAVEL_DOCUMENT_STATE_NOT_ALLOWED' USING ERRCODE = 'BB015';
  END;
  RETURN refusal IS NULL;
END
$$;

-- Key of the current scan of a restored card whose bytes still need verification.
CREATE OR REPLACE FUNCTION public.backbeat_travel_document_restore_probe(
  p_actor uuid, p_workspace_id uuid, p_file_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  found_key text;
BEGIN
  IF NOT public.backbeat_travel_document_is_member(p_actor, p_workspace_id) THEN
    RAISE EXCEPTION 'TRAVEL_DOCUMENT_ACTOR_NOT_MEMBER' USING ERRCODE = 'BB013';
  END IF;
  SELECT f.object_key INTO found_key
    FROM public.artist_travel_document_files AS f
    JOIN public.artist_travel_documents AS d ON d.id = f.document_id AND d.current_file_id = f.id
    WHERE f.id = p_file_id AND f.workspace_id = p_workspace_id AND d.state = 'active'
      AND f.state IN ('restore_pending', 'missing');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TRAVEL_DOCUMENT_STATE_NOT_ALLOWED' USING ERRCODE = 'BB015';
  END IF;
  RETURN found_key;
END
$$;

-- Result of the server's byte check after a restore. The comparison is made here against the
-- recorded size and digest: equal -> ready; absent (NULL) or different -> missing, never ready.
CREATE OR REPLACE FUNCTION public.backbeat_travel_document_confirm_restored_file(
  p_actor uuid, p_workspace_id uuid, p_file_id uuid, p_observed_size bigint, p_observed_sha256 text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  file public.artist_travel_document_files%ROWTYPE;
  doc public.artist_travel_documents%ROWTYPE;
  next_state text;
BEGIN
  IF NOT public.backbeat_travel_document_is_member(p_actor, p_workspace_id) THEN
    RAISE EXCEPTION 'TRAVEL_DOCUMENT_ACTOR_NOT_MEMBER' USING ERRCODE = 'BB013';
  END IF;
  SELECT * INTO file FROM public.artist_travel_document_files
    WHERE id = p_file_id AND workspace_id = p_workspace_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TRAVEL_DOCUMENT_NOT_FOUND' USING ERRCODE = 'BB014';
  END IF;
  SELECT * INTO doc FROM public.artist_travel_documents WHERE id = file.document_id FOR UPDATE;
  SELECT * INTO file FROM public.artist_travel_document_files WHERE id = p_file_id FOR UPDATE;
  IF doc.state <> 'active' OR doc.current_file_id IS DISTINCT FROM file.id
     OR file.state NOT IN ('restore_pending', 'missing') THEN
    RAISE EXCEPTION 'TRAVEL_DOCUMENT_STATE_NOT_ALLOWED' USING ERRCODE = 'BB015';
  END IF;
  next_state := CASE WHEN p_observed_size = file.byte_size AND p_observed_sha256 = file.sha256
    THEN 'ready' ELSE 'missing' END;
  IF next_state <> file.state THEN
    UPDATE public.artist_travel_document_files SET state = next_state WHERE id = file.id;
    PERFORM public.backbeat_travel_document_audit_write(doc.workspace_id, doc.artist_id, doc.id,
      file.id, p_actor,
      CASE next_state WHEN 'ready' THEN 'scan_restore_verified' ELSE 'scan_restore_missing' END,
      NULL, doc.generation);
  END IF;
  RETURN next_state;
END
$$;

-- ---------------------------------------------------------------------------------------------
-- Operator maintenance (EXECUTE: service_role only; run by ops/supabase/booking-travel/*.mjs,
-- never scheduled, never reachable from the app). Objects are removed through the Storage API by
-- the script; these functions only move state and never touch storage.objects rows.
-- ---------------------------------------------------------------------------------------------

-- Claim: cards archived with restore_until <= now() become purge_pending (no longer restorable;
-- same row lock and state test as restore, so exactly one of the two wins) and every admitted
-- object of those cards, plus superseded versions past their own cutoff, joins the workset.
-- Cards without admitted objects are scrubbed at once. Returns the number of objects claimed.
CREATE OR REPLACE FUNCTION public.backbeat_travel_document_purge_claim()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  doc public.artist_travel_documents%ROWTYPE;
  claimed integer := 0;
  step integer;
BEGIN
  FOR doc IN
    SELECT * FROM public.artist_travel_documents
    WHERE state = 'archived' AND restore_until <= pg_catalog.now()
    ORDER BY id FOR UPDATE
  LOOP
    UPDATE public.artist_travel_documents
      SET state = 'purge_pending', generation = generation + 1, updated_at = pg_catalog.now()
      WHERE id = doc.id;
    UPDATE public.artist_travel_document_files SET state = 'purge_pending'
      WHERE document_id = doc.id AND state IN ('ready', 'restore_pending', 'missing', 'superseded');
    GET DIAGNOSTICS step = ROW_COUNT;
    claimed := claimed + step;
    PERFORM public.backbeat_travel_document_audit_write(doc.workspace_id, doc.artist_id, doc.id,
      NULL, NULL, 'purge_claimed', NULL, doc.generation + 1);
    PERFORM public.backbeat_travel_document_scrub(doc.id);
  END LOOP;
  UPDATE public.artist_travel_document_files SET state = 'purge_pending'
    WHERE state = 'superseded' AND restore_until <= pg_catalog.now();
  GET DIAGNOSTICS step = ROW_COUNT;
  RETURN claimed + step;
END
$$;

-- Never-admitted reservations are a separate, separately authorized cleanup: they were never
-- document bytes of record. Only reservations older than p_min_age, and never younger than
-- 3 hours: a signed upload URL can still deliver bytes for about 2 hours after it was issued,
-- and a key must not be marked clean while its upload capability is alive.
CREATE OR REPLACE FUNCTION public.backbeat_travel_document_cleanup_claim(p_min_age interval)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  claimed integer;
BEGIN
  IF p_min_age IS NULL OR p_min_age < INTERVAL '3 hours' THEN
    RAISE EXCEPTION 'TRAVEL_DOCUMENT_STATE_NOT_ALLOWED' USING ERRCODE = 'BB015';
  END IF;
  UPDATE public.artist_travel_document_files SET state = 'cleanup_pending'
    WHERE state IN ('rejected', 'pending') AND reserved_at <= pg_catalog.now() - p_min_age;
  GET DIAGNOSTICS claimed = ROW_COUNT;
  RETURN claimed;
END
$$;

-- Read-only counts for the operator's dry run: what a claim would take now and what is waiting.
CREATE OR REPLACE FUNCTION public.backbeat_travel_document_purge_due()
RETURNS TABLE (due_documents bigint, due_objects bigint, claimed_objects bigint, never_admitted bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT
    (SELECT pg_catalog.count(*) FROM public.artist_travel_documents AS d
      WHERE d.state = 'archived' AND d.restore_until <= pg_catalog.now()),
    (SELECT pg_catalog.count(*) FROM public.artist_travel_document_files AS f
      JOIN public.artist_travel_documents AS d ON d.id = f.document_id
      WHERE (d.state = 'archived' AND d.restore_until <= pg_catalog.now()
             AND f.state IN ('ready', 'restore_pending', 'missing', 'superseded'))
         OR (f.state = 'superseded' AND f.restore_until <= pg_catalog.now())),
    (SELECT pg_catalog.count(*) FROM public.artist_travel_document_files AS f
      WHERE f.state IN ('purge_pending', 'cleanup_pending')),
    (SELECT pg_catalog.count(*) FROM public.artist_travel_document_files AS f
      WHERE f.state IN ('pending', 'rejected'));
$$;

-- Durable workset, re-read by the script before every removal: only rows still claimed.
CREATE OR REPLACE FUNCTION public.backbeat_travel_document_purge_worklist()
RETURNS TABLE (file_id uuid, object_key text, kind text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT f.id, f.object_key, f.state FROM public.artist_travel_document_files AS f
  WHERE f.state IN ('purge_pending', 'cleanup_pending') ORDER BY f.id;
$$;

-- Confirm one object as absent. Refused (BB015) unless the row is still claimed, and, where the
-- Storage catalog is readable, while storage.objects still lists the key in p_bucket. When the
-- last claimed object of a purge_pending card is confirmed, the card is scrubbed.
CREATE OR REPLACE FUNCTION public.backbeat_travel_document_purge_confirm(p_file_id uuid, p_bucket text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  file public.artist_travel_document_files%ROWTYPE;
  still_there boolean := false;
BEGIN
  -- Same lock order as every other function: the card first, then the scan row.
  PERFORM 1 FROM public.artist_travel_documents AS d
    WHERE d.id = (SELECT f.document_id FROM public.artist_travel_document_files AS f WHERE f.id = p_file_id)
    FOR UPDATE;
  SELECT * INTO file FROM public.artist_travel_document_files WHERE id = p_file_id FOR UPDATE;
  IF NOT FOUND OR file.state NOT IN ('purge_pending', 'cleanup_pending') THEN
    RAISE EXCEPTION 'TRAVEL_DOCUMENT_STATE_NOT_ALLOWED' USING ERRCODE = 'BB015';
  END IF;
  IF pg_catalog.to_regclass('storage.objects') IS NOT NULL THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = $1 AND name = $2)'
      INTO still_there USING p_bucket, file.object_key;
  END IF;
  IF still_there THEN
    RAISE EXCEPTION 'TRAVEL_DOCUMENT_STATE_NOT_ALLOWED' USING ERRCODE = 'BB015';
  END IF;
  UPDATE public.artist_travel_document_files
    SET state = CASE file.state WHEN 'purge_pending' THEN 'purged' ELSE 'cleaned' END,
        purged_at = pg_catalog.now(), media_type = NULL, byte_size = NULL, sha256 = NULL
    WHERE id = file.id;
  PERFORM public.backbeat_travel_document_audit_write(file.workspace_id, file.artist_id,
    file.document_id, file.id, NULL,
    CASE file.state WHEN 'purge_pending' THEN 'file_purged' ELSE 'quarantine_cleaned' END);
  PERFORM public.backbeat_travel_document_scrub(file.document_id);
  RETURN CASE file.state WHEN 'purge_pending' THEN 'purged' ELSE 'cleaned' END;
END
$$;

-- Audit retention (owner parameter: 24 calendar months, separately authorized, not automatic).
-- Removes only rows older than p_before, and refuses (BB021) a cutoff younger than 24 months.
CREATE OR REPLACE FUNCTION public.backbeat_travel_document_audit_retention_purge(p_before timestamptz)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  removed bigint;
BEGIN
  IF p_before IS NULL OR p_before >
     ((pg_catalog.now() AT TIME ZONE 'UTC') - INTERVAL '24 months') AT TIME ZONE 'UTC' THEN
    RAISE EXCEPTION 'TRAVEL_DOCUMENT_AUDIT_RETENTION_TOO_RECENT' USING ERRCODE = 'BB021';
  END IF;
  PERFORM pg_catalog.set_config('backbeat.travel_audit_retention', 'purge', true);
  DELETE FROM public.artist_travel_document_audit WHERE occurred_at < p_before;
  GET DIAGNOSTICS removed = ROW_COUNT;
  PERFORM pg_catalog.set_config('backbeat.travel_audit_retention', '', true);
  RETURN removed;
END
$$;

-- ---------------------------------------------------------------------------------------------
-- Access. Explicit revocation first, then the minimum.
-- ---------------------------------------------------------------------------------------------
ALTER TABLE public.booking_travel_legs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.booking_stays ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.artist_travel_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.artist_travel_document_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.artist_travel_document_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.artist_travel_document_relationships ENABLE ROW LEVEL SECURITY;

-- Legs and stays: same minimum-access shape as 001. UPDATE is column-scoped: id, workspace_id,
-- the parent key and created_at are never rewritten.
REVOKE ALL ON TABLE public.booking_travel_legs, public.booking_stays FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.booking_travel_legs, public.booking_stays TO authenticated;
GRANT UPDATE (direction, mode, carrier, reference, depart_place, depart_date, depart_time,
  depart_zone, arrive_place, arrive_date, arrive_time, arrive_zone, travellers, driver_name,
  driver_phone, notes, updated_at) ON public.booking_travel_legs TO authenticated;
GRANT UPDATE (name, address, check_in_on, check_out_on, confirmation_ref, notes, updated_at)
  ON public.booking_stays TO authenticated;

-- Travel documents: nothing for anon; the trusted server role gets no table privilege at all
-- (it works only through the functions above); a member session gets:
--   cards          SELECT; INSERT / UPDATE of the data fields only; no DELETE; no lifecycle column
--   scan versions  SELECT without object_key and sha256; no write
--   audit          SELECT only
--   relationships  SELECT only
REVOKE ALL ON TABLE public.artist_travel_documents, public.artist_travel_document_files,
  public.artist_travel_document_audit, public.artist_travel_document_relationships
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.artist_travel_documents, public.artist_travel_document_audit,
  public.artist_travel_document_relationships TO authenticated;
GRANT INSERT (workspace_id, artist_id, doc_type, number, issuing_country, nationality, issued_on,
  expires_on, holder_name) ON public.artist_travel_documents TO authenticated;
GRANT UPDATE (doc_type, number, issuing_country, nationality, issued_on, expires_on, holder_name,
  updated_at) ON public.artist_travel_documents TO authenticated;
GRANT SELECT (id, workspace_id, artist_id, document_id, state, media_type, byte_size, reserved_at,
  finalized_at, archived_at, restore_until) ON public.artist_travel_document_files TO authenticated;

-- Decision 5 / D1: every active member of the workspace; no role or referent policy.
DROP POLICY IF EXISTS booking_travel_leg_access ON public.booking_travel_legs;
CREATE POLICY booking_travel_leg_access ON public.booking_travel_legs FOR ALL TO authenticated
  USING (public.backbeat_is_active_member(workspace_id))
  WITH CHECK (public.backbeat_is_active_member(workspace_id));
DROP POLICY IF EXISTS booking_stay_access ON public.booking_stays;
CREATE POLICY booking_stay_access ON public.booking_stays FOR ALL TO authenticated
  USING (public.backbeat_is_active_member(workspace_id))
  WITH CHECK (public.backbeat_is_active_member(workspace_id));
DROP POLICY IF EXISTS artist_travel_document_access ON public.artist_travel_documents;
DROP POLICY IF EXISTS artist_travel_document_read ON public.artist_travel_documents;
-- Active cards, and archived ones while they are still on record for recovery. A card claimed
-- by the purge, or purged, is no longer readable by a session.
CREATE POLICY artist_travel_document_read ON public.artist_travel_documents FOR SELECT TO authenticated
  USING (public.backbeat_is_active_member(workspace_id) AND state IN ('active', 'archived'));
DROP POLICY IF EXISTS artist_travel_document_create ON public.artist_travel_documents;
CREATE POLICY artist_travel_document_create ON public.artist_travel_documents FOR INSERT TO authenticated
  WITH CHECK (public.backbeat_is_active_member(workspace_id) AND state = 'active');
-- Only an active card is editable; archived cards change through restore, never in place.
DROP POLICY IF EXISTS artist_travel_document_edit ON public.artist_travel_documents;
CREATE POLICY artist_travel_document_edit ON public.artist_travel_documents FOR UPDATE TO authenticated
  USING (public.backbeat_is_active_member(workspace_id) AND state = 'active')
  WITH CHECK (public.backbeat_is_active_member(workspace_id) AND state = 'active');
DROP POLICY IF EXISTS artist_travel_document_file_read ON public.artist_travel_document_files;
CREATE POLICY artist_travel_document_file_read ON public.artist_travel_document_files FOR SELECT TO authenticated
  USING (public.backbeat_is_active_member(workspace_id));
DROP POLICY IF EXISTS artist_travel_document_audit_read ON public.artist_travel_document_audit;
CREATE POLICY artist_travel_document_audit_read ON public.artist_travel_document_audit FOR SELECT TO authenticated
  USING (public.backbeat_is_active_member(workspace_id));
DROP POLICY IF EXISTS artist_travel_document_relationship_read ON public.artist_travel_document_relationships;
CREATE POLICY artist_travel_document_relationship_read ON public.artist_travel_document_relationships FOR SELECT TO authenticated
  USING (public.backbeat_is_active_member(workspace_id));

-- The audit sequence is advanced only by the audit writer (definer): no API role may touch it.
DO $sequence$
BEGIN
  EXECUTE pg_catalog.format('REVOKE ALL ON SEQUENCE %s FROM PUBLIC, anon, authenticated, service_role',
    pg_catalog.pg_get_serial_sequence('public.artist_travel_document_audit', 'seq'));
END
$sequence$;

-- Functions: nobody by default, then exactly one caller class each.
REVOKE ALL ON FUNCTION
  public.backbeat_travel_document_cutoff(timestamptz),
  public.backbeat_travel_document_is_member(uuid, uuid),
  public.backbeat_travel_document_audit_write(uuid, uuid, uuid, uuid, uuid, text, text, bigint, uuid, uuid, uuid),
  public.backbeat_travel_document_archive_row(uuid, text, uuid),
  public.backbeat_travel_document_scrub(uuid),
  public.backbeat_travel_document_audit_guard(),
  public.backbeat_travel_document_protect(),
  public.backbeat_travel_document_card_audit(),
  public.backbeat_travel_document_archive(uuid, uuid),
  public.backbeat_travel_document_restore(uuid, uuid),
  public.backbeat_travel_document_relationship_end(uuid, uuid),
  public.backbeat_travel_document_relationship_resume(uuid, uuid),
  public.backbeat_travel_document_reserve_upload(uuid, uuid, uuid),
  public.backbeat_travel_document_pending_key(uuid, uuid, uuid),
  public.backbeat_travel_document_finalize_upload(uuid, uuid, uuid, text, bigint, text, text),
  public.backbeat_travel_document_authorize_download(uuid, uuid, uuid, uuid, uuid, uuid),
  public.backbeat_travel_document_record_issuance(uuid, uuid, uuid, uuid, bigint, boolean),
  public.backbeat_travel_document_restore_probe(uuid, uuid, uuid),
  public.backbeat_travel_document_confirm_restored_file(uuid, uuid, uuid, bigint, text),
  public.backbeat_travel_document_purge_claim(),
  public.backbeat_travel_document_cleanup_claim(interval),
  public.backbeat_travel_document_purge_due(),
  public.backbeat_travel_document_purge_worklist(),
  public.backbeat_travel_document_purge_confirm(uuid, text),
  public.backbeat_travel_document_audit_retention_purge(timestamptz)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION
  public.backbeat_travel_document_archive(uuid, uuid),
  public.backbeat_travel_document_restore(uuid, uuid),
  public.backbeat_travel_document_relationship_end(uuid, uuid),
  public.backbeat_travel_document_relationship_resume(uuid, uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION
  public.backbeat_travel_document_reserve_upload(uuid, uuid, uuid),
  public.backbeat_travel_document_pending_key(uuid, uuid, uuid),
  public.backbeat_travel_document_finalize_upload(uuid, uuid, uuid, text, bigint, text, text),
  public.backbeat_travel_document_authorize_download(uuid, uuid, uuid, uuid, uuid, uuid),
  public.backbeat_travel_document_record_issuance(uuid, uuid, uuid, uuid, bigint, boolean),
  public.backbeat_travel_document_restore_probe(uuid, uuid, uuid),
  public.backbeat_travel_document_confirm_restored_file(uuid, uuid, uuid, bigint, text),
  public.backbeat_travel_document_purge_claim(),
  public.backbeat_travel_document_cleanup_claim(interval),
  public.backbeat_travel_document_purge_due(),
  public.backbeat_travel_document_purge_worklist(),
  public.backbeat_travel_document_purge_confirm(uuid, text),
  public.backbeat_travel_document_audit_retention_purge(timestamptz)
  TO service_role;

-- bookings and artists: RLS, grants, policies, triggers and rows are unchanged
-- (one nullable column each: bookings.transport_to_city, artists.date_of_birth).
NOTIFY pgrst, 'reload schema';
COMMIT;
