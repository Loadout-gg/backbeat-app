-- D0.2 of ARCH-20261114-booking-domain r02 (staging delegation, 2026-11-21).
-- Additive: UNIQUE (workspace_id, id) on bookings, so later child tables can use the
-- same-workspace composite foreign key that artists and promoters already offer.
-- Idempotent: safe to re-run. Prefix with an explicit target, in the same run:
--   SET backbeat.booking_lifecycle_target = 'development';                 -- synthetic local
--   SET backbeat.booking_lifecycle_target = 'hosted:hupkygptbvnzrihrlcxv'; -- staging
-- Both targets require the synthetic-development marker (public.runtime_environment),
-- which production does not have. Production is not an allowed target of this file.
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
DO $apply$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint AS con
    WHERE con.conrelid = 'public.bookings'::pg_catalog.regclass AND con.contype IN ('u', 'p')
      AND (SELECT pg_catalog.array_agg(att.attname::text ORDER BY att.attname::text)
           FROM pg_catalog.unnest(con.conkey) AS key(attnum)
           JOIN pg_catalog.pg_attribute AS att
             ON att.attrelid = con.conrelid AND att.attnum = key.attnum)
          = ARRAY['id', 'workspace_id']
  ) THEN
    ALTER TABLE public.bookings
      ADD CONSTRAINT bookings_workspace_id_id_key UNIQUE (workspace_id, id);
  END IF;
END
$apply$;
-- RLS, grants, policies, triggers and rows are unchanged.
NOTIFY pgrst, 'reload schema';
COMMIT;
