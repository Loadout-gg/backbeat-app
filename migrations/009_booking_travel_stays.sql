-- P4 of ARCH-20261114-booking-domain r02 (staging delegation, Simone decisions 2026-11-23).
-- Additive: booking_travel_legs and booking_stays (children of bookings), artist_travel_documents
-- (child of artists) and artists.date_of_birth. No backfill, no row of an existing table changes.
-- Travel documents and date of birth are sensitive personal data: read them only through the
-- explicit projections in lib/actions/booking-travel.ts and lib/actions/artist-travel-documents.ts.
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
    OR pg_catalog.to_regclass('public.artist_travel_documents_rollback_backup') IS NOT NULL) THEN
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
  -- Arrival not before departure. Times are compared only on the same date with the same zone
  -- label: local clock times in different zones are not comparable without a zone policy.
  CONSTRAINT booking_travel_legs_order_check CHECK (
    depart_date IS NULL OR arrive_date IS NULL OR arrive_date > depart_date
    OR (arrive_date = depart_date AND (
      depart_time IS NULL OR arrive_time IS NULL OR arrive_time >= depart_time
      OR pg_catalog.lower(pg_catalog.btrim(coalesce(depart_zone, '')))
         <> pg_catalog.lower(pg_catalog.btrim(coalesce(arrive_zone, '')))))),
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

CREATE TABLE IF NOT EXISTS public.artist_travel_documents (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  artist_id uuid NOT NULL,
  doc_type text NOT NULL,
  number text NOT NULL,
  issuing_country text,
  expires_on date,
  holder_name text,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT artist_travel_documents_artist_fkey FOREIGN KEY (workspace_id, artist_id)
    REFERENCES public.artists(workspace_id, id) ON DELETE CASCADE,
  CONSTRAINT artist_travel_documents_doc_type_check
    CHECK (doc_type IN ('passport', 'id_card', 'other')),
  CONSTRAINT artist_travel_documents_lengths CHECK (
    pg_catalog.char_length(pg_catalog.btrim(number)) BETWEEN 1 AND 64
    AND coalesce(pg_catalog.char_length(issuing_country), 0) <= 100
    AND coalesce(pg_catalog.char_length(holder_name), 0) <= 200)
);

ALTER TABLE public.artists ADD COLUMN IF NOT EXISTS date_of_birth date;
ALTER TABLE public.artists DROP CONSTRAINT IF EXISTS artists_date_of_birth_check;
ALTER TABLE public.artists
  ADD CONSTRAINT artists_date_of_birth_check
    CHECK (date_of_birth IS NULL OR date_of_birth >= DATE '1900-01-01');

-- A re-run must not silently accept a table of the same name with another shape.
DO $shape$
BEGIN
  IF (SELECT pg_catalog.count(*) FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'booking_travel_legs') <> 21
     OR (SELECT pg_catalog.count(*) FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'booking_stays') <> 11
     OR (SELECT pg_catalog.count(*) FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'artist_travel_documents') <> 10
     OR (SELECT pg_catalog.count(*) FROM pg_catalog.pg_constraint
      WHERE contype = 'f' AND (conrelid, conname) IN (
        ('public.booking_travel_legs'::pg_catalog.regclass, 'booking_travel_legs_booking_fkey'),
        ('public.booking_stays'::pg_catalog.regclass, 'booking_stays_booking_fkey'),
        ('public.artist_travel_documents'::pg_catalog.regclass, 'artist_travel_documents_artist_fkey'))) <> 3 THEN
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

ALTER TABLE public.booking_travel_legs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.booking_stays ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.artist_travel_documents ENABLE ROW LEVEL SECURITY;

-- Same minimum-access shape as 001: remove default grants, then grant to authenticated only.
-- UPDATE is column-scoped: id, workspace_id, the parent key and created_at are never rewritten,
-- so a row cannot be moved to another booking, artist or workspace.
REVOKE ALL ON TABLE public.booking_travel_legs, public.booking_stays,
  public.artist_travel_documents FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.booking_travel_legs, public.booking_stays,
  public.artist_travel_documents TO authenticated;
GRANT UPDATE (direction, mode, carrier, reference, depart_place, depart_date, depart_time,
  depart_zone, arrive_place, arrive_date, arrive_time, arrive_zone, travellers, driver_name,
  driver_phone, notes, updated_at) ON public.booking_travel_legs TO authenticated;
GRANT UPDATE (name, address, check_in_on, check_out_on, confirmation_ref, notes, updated_at)
  ON public.booking_stays TO authenticated;
GRANT UPDATE (doc_type, number, issuing_country, expires_on, holder_name, updated_at)
  ON public.artist_travel_documents TO authenticated;

-- Decision 5: every active member of the workspace sees and edits everything; no role policy.
DROP POLICY IF EXISTS booking_travel_leg_access ON public.booking_travel_legs;
CREATE POLICY booking_travel_leg_access ON public.booking_travel_legs FOR ALL TO authenticated
  USING (public.backbeat_is_active_member(workspace_id))
  WITH CHECK (public.backbeat_is_active_member(workspace_id));
DROP POLICY IF EXISTS booking_stay_access ON public.booking_stays;
CREATE POLICY booking_stay_access ON public.booking_stays FOR ALL TO authenticated
  USING (public.backbeat_is_active_member(workspace_id))
  WITH CHECK (public.backbeat_is_active_member(workspace_id));
DROP POLICY IF EXISTS artist_travel_document_access ON public.artist_travel_documents;
CREATE POLICY artist_travel_document_access ON public.artist_travel_documents FOR ALL TO authenticated
  USING (public.backbeat_is_active_member(workspace_id))
  WITH CHECK (public.backbeat_is_active_member(workspace_id));

-- bookings and artists: RLS, grants, policies, triggers and rows are unchanged.
NOTIFY pgrst, 'reload schema';
COMMIT;
