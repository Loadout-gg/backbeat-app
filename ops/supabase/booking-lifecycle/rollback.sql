-- Rollback of migrations/006_booking_lifecycle.sql. Redeploy the previous app version first.
-- Lossy for the live table: hold/option rows become in_progress and hold_expires_on is
-- dropped. Their previous values are first copied to bookings_lifecycle_rollback_backup
-- (RLS on, no grants, no policies: invisible to the API) so restore.sql can put them back.
-- The additive UNIQUE (workspace_id, id) from 005 is kept. Same explicit target as 006.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '15s';
DO $guard$
DECLARE target text := pg_catalog.current_setting('backbeat.booking_lifecycle_target', true);
BEGIN
  IF target = 'development' THEN
    IF pg_catalog.to_regclass('public.runtime_environment') IS NULL THEN
      RAISE EXCEPTION 'BOOKING_LIFECYCLE_DEVELOPMENT_MARKER_MISSING';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.runtime_environment
      WHERE id = 'backbeat-dev' AND environment = 'development' AND synthetic_only IS TRUE
    ) OR (SELECT pg_catalog.count(*) FROM public.runtime_environment) <> 1 THEN
      RAISE EXCEPTION 'BOOKING_LIFECYCLE_DEVELOPMENT_MARKER_INVALID';
    END IF;
  ELSIF target = 'hosted:hupkygptbvnzrihrlcxv' THEN
    -- Staging only (owner statement, 2026-11-21). The setting is an accidental-target
    -- guard, not identity proof: check the project ref in the dashboard before running.
    IF pg_catalog.to_regprocedure('public.backbeat_is_active_member(uuid)') IS NULL THEN
      RAISE EXCEPTION 'BOOKING_LIFECYCLE_HOSTED_SHAPE_MISMATCH';
    END IF;
  ELSE
    RAISE EXCEPTION 'BOOKING_LIFECYCLE_TARGET_NOT_EXPLICIT';
  END IF;
  IF pg_catalog.to_regclass('public.bookings') IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class
    WHERE oid = pg_catalog.to_regclass('public.bookings') AND relrowsecurity
  ) THEN
    RAISE EXCEPTION 'BOOKING_LIFECYCLE_BOOKINGS_RLS_REQUIRED';
  END IF;
END
$guard$;
DROP TRIGGER IF EXISTS bookings_enforce_status ON public.bookings;
DROP FUNCTION IF EXISTS public.backbeat_enforce_booking_status();

CREATE TABLE IF NOT EXISTS public.bookings_lifecycle_rollback_backup (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  status text NOT NULL,
  hold_expires_on date,
  backed_up_at timestamptz NOT NULL DEFAULT pg_catalog.now()
);
ALTER TABLE public.bookings_lifecycle_rollback_backup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.bookings_lifecycle_rollback_backup FROM PUBLIC, anon, authenticated;

DO $backup$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
      AND table_name = 'bookings' AND column_name = 'hold_expires_on') THEN
    INSERT INTO public.bookings_lifecycle_rollback_backup (id, workspace_id, status, hold_expires_on)
      SELECT id, workspace_id, status, hold_expires_on FROM public.bookings
      WHERE status IN ('hold', 'option') OR hold_expires_on IS NOT NULL
      ON CONFLICT (id) DO NOTHING;
  END IF;
END
$backup$;

ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_hold_expires_on_check;
ALTER TABLE public.bookings DROP COLUMN IF EXISTS hold_expires_on;
UPDATE public.bookings SET status = 'in_progress' WHERE status IN ('hold', 'option');
ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_status_check;
ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_status_check
    CHECK (status IN ('in_progress', 'confirmed', 'cancelled', 'completed'));
NOTIFY pgrst, 'reload schema';
COMMIT;
