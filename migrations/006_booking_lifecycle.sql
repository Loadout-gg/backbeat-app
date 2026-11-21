-- P1 of ARCH-20261114-booking-domain r02 (staging delegation, 2026-11-21).
-- Adds statuses hold/option, hold_expires_on, and a trigger that enforces the status
-- transition graph for every writer, including raw REST. No row is rewritten.
-- Idempotent: safe to re-run. Requires 002, 004 and 005. Prefix with an explicit target:
--   SET backbeat.booking_lifecycle_target = 'development';                 -- synthetic local
--   SET backbeat.booking_lifecycle_target = 'hosted:hupkygptbvnzrihrlcxv'; -- staging
-- Both targets require the synthetic-development marker (public.runtime_environment),
-- which production does not have. Production is not an allowed target of this file.
-- Rollback: ops/supabase/booking-lifecycle/rollback.sql (see docs/booking-lifecycle.md).
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '15s';
DO $guard$
DECLARE target text := pg_catalog.current_setting('backbeat.booking_lifecycle_target', true);
BEGIN
  -- Two explicit targets, both of the synthetic-development class of migration 004: a local
  -- development database, or Backbeat staging (which carries the same marker and received
  -- 004 through its 'development' path). 004's own hosted branch is production: it has no
  -- marker, so the marker requirement below refuses it whatever the setting says.
  IF target IS NULL OR target NOT IN ('development', 'hosted:hupkygptbvnzrihrlcxv') THEN
    RAISE EXCEPTION 'BOOKING_LIFECYCLE_TARGET_NOT_EXPLICIT';
  END IF;
  IF pg_catalog.to_regclass('public.runtime_environment') IS NULL THEN
    RAISE EXCEPTION 'BOOKING_LIFECYCLE_SYNTHETIC_MARKER_MISSING';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.runtime_environment
    WHERE id = 'backbeat-dev' AND environment = 'development' AND synthetic_only IS TRUE
  ) OR (SELECT pg_catalog.count(*) FROM public.runtime_environment) <> 1 THEN
    RAISE EXCEPTION 'BOOKING_LIFECYCLE_SYNTHETIC_MARKER_INVALID';
  END IF;
  IF pg_catalog.to_regprocedure('public.backbeat_is_active_member(uuid)') IS NULL THEN
    RAISE EXCEPTION 'BOOKING_LIFECYCLE_SHAPE_MISMATCH';
  END IF;
  IF pg_catalog.to_regclass('public.bookings') IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class
    WHERE oid = pg_catalog.to_regclass('public.bookings') AND relrowsecurity
  ) THEN
    RAISE EXCEPTION 'BOOKING_LIFECYCLE_BOOKINGS_RLS_REQUIRED';
  END IF;
END
$guard$;
DO $requires$
BEGIN
  IF (SELECT pg_catalog.count(*) FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'bookings'
        AND column_name IN ('venue_name', 'venue_address', 'contact_name_main',
          'contact_phone_main', 'contact_email_main', 'fee_amount_minor', 'fee_currency')) <> 7 THEN
    RAISE EXCEPTION 'BOOKING_LIFECYCLE_REQUIRES_002_AND_004';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
      WHERE conrelid = 'public.bookings'::pg_catalog.regclass
        AND conname = 'bookings_workspace_id_id_key' AND contype = 'u') THEN
    RAISE EXCEPTION 'BOOKING_LIFECYCLE_REQUIRES_005';
  END IF;
  LOCK TABLE public.bookings IN SHARE ROW EXCLUSIVE MODE;
  IF EXISTS (SELECT 1 FROM public.bookings WHERE status NOT IN
      ('in_progress', 'hold', 'option', 'confirmed', 'cancelled', 'completed')) THEN
    RAISE EXCEPTION 'BOOKING_LIFECYCLE_UNEXPECTED_STATUS_ROWS';
  END IF;
END
$requires$;

-- Replace every single-column CHECK on status (hosted name verified: bookings_status_check).
DO $status_check$
DECLARE existing record;
BEGIN
  FOR existing IN
    SELECT con.conname FROM pg_catalog.pg_constraint AS con
    WHERE con.conrelid = 'public.bookings'::pg_catalog.regclass AND con.contype = 'c'
      AND con.conkey = ARRAY[(SELECT att.attnum FROM pg_catalog.pg_attribute AS att
        WHERE att.attrelid = con.conrelid AND att.attname = 'status')]
  LOOP
    EXECUTE pg_catalog.format('ALTER TABLE public.bookings DROP CONSTRAINT %I', existing.conname);
  END LOOP;
END
$status_check$;
ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_status_check CHECK (status IN
    ('in_progress', 'hold', 'option', 'confirmed', 'cancelled', 'completed'));

ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS hold_expires_on date;
ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_hold_expires_on_check;
ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_hold_expires_on_check
    CHECK (hold_expires_on IS NULL OR status = 'hold');

-- SECURITY INVOKER: runs as the writer, reads only NEW/OLD, touches no other relation.
-- SQLSTATE BB001 initial status, BB002 transition not in graph, BB003 completed too early.
-- Unknown status values are left to bookings_status_check (23514).
CREATE OR REPLACE FUNCTION public.backbeat_enforce_booking_status()
RETURNS trigger LANGUAGE plpgsql SET search_path = ''
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status IN ('hold', 'option', 'confirmed', 'cancelled', 'completed') THEN
      RAISE EXCEPTION 'BOOKING_INITIAL_STATUS_MUST_BE_IN_PROGRESS' USING ERRCODE = 'BB001';
    END IF;
    RETURN NEW;
  END IF;

  -- The graph is evaluated only when the status actually changes, so ordinary edits of
  -- a completed or cancelled booking (notes, venue, fee) still pass.
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status IN ('in_progress', 'hold', 'option', 'confirmed', 'cancelled', 'completed')
       AND NOT coalesce(CASE OLD.status
         WHEN 'in_progress' THEN NEW.status IN ('hold', 'option', 'confirmed', 'cancelled')
         WHEN 'hold' THEN NEW.status IN ('option', 'confirmed', 'cancelled', 'in_progress')
         WHEN 'option' THEN NEW.status IN ('confirmed', 'cancelled', 'hold')
         WHEN 'confirmed' THEN NEW.status IN ('cancelled', 'completed')
         WHEN 'cancelled' THEN NEW.status = 'in_progress'
         ELSE false
       END, false) THEN
      RAISE EXCEPTION 'BOOKING_STATUS_TRANSITION_NOT_ALLOWED' USING ERRCODE = 'BB002';
    END IF;
    IF NEW.status <> 'hold' THEN
      NEW.hold_expires_on := NULL;
    END IF;
  END IF;

  -- completed = the show was performed. The app applies the strict rule in its calendar
  -- zone; one day of tolerance keeps this UTC backstop from rejecting zones ahead of UTC.
  IF NEW.status = 'completed'
     AND (NEW.status IS DISTINCT FROM OLD.status OR NEW.date IS DISTINCT FROM OLD.date)
     AND NEW.date > (CURRENT_DATE + 1) THEN
    RAISE EXCEPTION 'BOOKING_COMPLETED_REQUIRES_PAST_DATE' USING ERRCODE = 'BB003';
  END IF;

  RETURN NEW;
END
$function$;
REVOKE ALL ON FUNCTION public.backbeat_enforce_booking_status() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS bookings_enforce_status ON public.bookings;
CREATE TRIGGER bookings_enforce_status BEFORE INSERT OR UPDATE ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.backbeat_enforce_booking_status();

-- RLS, grants and policies are unchanged: booking access stays active-member scoped.
NOTIFY pgrst, 'reload schema';
COMMIT;
