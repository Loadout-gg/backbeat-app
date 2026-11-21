-- Restore after rollback.sql, once migrations/006_booking_lifecycle.sql is applied again.
-- Puts hold/option and hold_expires_on back on bookings that are still in_progress
-- (in_progress -> hold/option is a graph transition, so the trigger stays enabled),
-- then drops the backup table. Rows changed since the rollback are left as they are.
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
UPDATE public.bookings AS b
  SET status = k.status,
      hold_expires_on = CASE WHEN k.status = 'hold' THEN k.hold_expires_on END
  FROM public.bookings_lifecycle_rollback_backup AS k
  WHERE b.id = k.id AND b.workspace_id = k.workspace_id
    AND b.status = 'in_progress' AND k.status IN ('hold', 'option');
DROP TABLE public.bookings_lifecycle_rollback_backup;
COMMIT;
