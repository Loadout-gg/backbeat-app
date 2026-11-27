-- Rollback of migrations/008_booking_event.sql. Redeploy the previous app version first;
-- the previous version also runs unchanged on the 008 schema, so this file is needed only
-- to remove the schema itself. Lossy for the live tables: the booking link, start time and
-- fee snapshot of events and the promoter of bookings are removed, with the triggers and
-- functions that gate the link on the booking status, keep the event of a cancelled
-- booking cancelled and refuse the deletion of a booking that has an event. Event statuses already set to cancelled stay cancelled. They are first copied to
-- booking_event_rollback_backup (RLS on, no grants, no policies: invisible to the API).
-- Re-running is safe: a later rollback overwrites the backup of a row that still exists with
-- its current values and keeps the backup of rows that are already gone. Events and bookings
-- themselves are never deleted. The additive UNIQUE (workspace_id, id) on events is kept.
-- Same explicit target as 008.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '15s';
DO $guard$
DECLARE
  target text := pg_catalog.current_setting('backbeat.booking_event_target', true);
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
    RAISE EXCEPTION 'BOOKING_EVENT_TARGET_NOT_EXPLICIT';
  END IF;
  IF pg_catalog.to_regclass('public.runtime_environment') IS NULL THEN
    RAISE EXCEPTION 'BOOKING_EVENT_SYNTHETIC_MARKER_MISSING';
  END IF;
  IF (SELECT pg_catalog.count(*) FROM public.runtime_environment) <> 1 OR NOT EXISTS (
    SELECT 1 FROM public.runtime_environment
    WHERE id = expected_id AND environment = expected_environment AND synthetic_only IS TRUE
  ) THEN
    RAISE EXCEPTION 'BOOKING_EVENT_MARKER_DOES_NOT_MATCH_TARGET';
  END IF;
  IF pg_catalog.to_regclass('public.events') IS NULL OR pg_catalog.to_regclass('public.bookings') IS NULL THEN
    RAISE EXCEPTION 'BOOKING_EVENT_SHAPE_MISMATCH';
  END IF;
END
$guard$;

CREATE TABLE IF NOT EXISTS public.booking_event_rollback_backup (
  source text NOT NULL CHECK (source IN ('event', 'booking')),
  id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  booking_id uuid,
  start_time time,
  fee_amount_minor bigint,
  fee_currency text,
  promoter_id uuid,
  backed_up_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  PRIMARY KEY (source, id)
);
ALTER TABLE public.booking_event_rollback_backup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.booking_event_rollback_backup FROM PUBLIC, anon, authenticated;

DO $backup$
BEGIN
  IF (SELECT pg_catalog.count(*) FROM information_schema.columns WHERE table_schema = 'public'
      AND table_name = 'events'
      AND column_name IN ('booking_id', 'start_time', 'fee_amount_minor', 'fee_currency')) = 4 THEN
    INSERT INTO public.booking_event_rollback_backup
        (source, id, workspace_id, booking_id, start_time, fee_amount_minor, fee_currency)
      SELECT 'event', id, workspace_id, booking_id, start_time, fee_amount_minor, fee_currency
      FROM public.events
      WHERE booking_id IS NOT NULL OR start_time IS NOT NULL OR fee_amount_minor IS NOT NULL
      ON CONFLICT (source, id) DO UPDATE SET workspace_id = EXCLUDED.workspace_id,
        booking_id = EXCLUDED.booking_id, start_time = EXCLUDED.start_time,
        fee_amount_minor = EXCLUDED.fee_amount_minor, fee_currency = EXCLUDED.fee_currency,
        backed_up_at = pg_catalog.now();
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
      AND table_name = 'bookings' AND column_name = 'promoter_id') THEN
    INSERT INTO public.booking_event_rollback_backup (source, id, workspace_id, promoter_id)
      SELECT 'booking', id, workspace_id, promoter_id FROM public.bookings WHERE promoter_id IS NOT NULL
      ON CONFLICT (source, id) DO UPDATE SET workspace_id = EXCLUDED.workspace_id,
        promoter_id = EXCLUDED.promoter_id, backed_up_at = pg_catalog.now();
  END IF;
END
$backup$;

DROP TRIGGER IF EXISTS bookings_keep_event ON public.bookings;
DROP FUNCTION IF EXISTS public.backbeat_keep_booking_with_event();
DROP TRIGGER IF EXISTS events_keep_cancelled ON public.events;
DROP FUNCTION IF EXISTS public.backbeat_keep_cancelled_event();
DROP TRIGGER IF EXISTS bookings_cancel_event ON public.bookings;
DROP FUNCTION IF EXISTS public.backbeat_cancel_booking_event();
DROP TRIGGER IF EXISTS events_enforce_booking ON public.events;
DROP FUNCTION IF EXISTS public.backbeat_enforce_event_booking();
DROP INDEX IF EXISTS public.bookings_workspace_promoter_idx;
ALTER TABLE public.bookings
  DROP CONSTRAINT IF EXISTS bookings_promoter_id_fkey,
  DROP COLUMN IF EXISTS promoter_id;
ALTER TABLE public.events
  DROP CONSTRAINT IF EXISTS events_booking_id_fkey,
  DROP CONSTRAINT IF EXISTS events_booking_id_key,
  DROP CONSTRAINT IF EXISTS events_fee_amount_minor_check,
  DROP CONSTRAINT IF EXISTS events_fee_currency_check,
  DROP CONSTRAINT IF EXISTS events_fee_pair_check,
  DROP CONSTRAINT IF EXISTS events_status_check,
  DROP COLUMN IF EXISTS booking_id,
  DROP COLUMN IF EXISTS start_time,
  DROP COLUMN IF EXISTS fee_amount_minor,
  DROP COLUMN IF EXISTS fee_currency;
NOTIFY pgrst, 'reload schema';
COMMIT;
