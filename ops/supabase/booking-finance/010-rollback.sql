-- Rollback of migrations/010_booking_payment_history.sql. Redeploy the app version that does
-- not read the 010 columns first. Not lossy: it refuses while any payment is voided, corrected
-- or a correction, so recorded history is never dropped by this file. Same explicit target as 010.
-- NOT APPLIED ANYWHERE. RESERVED: Alberto approves these exact bytes, target and order.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '15s';
DO $guard$
DECLARE
  target text := pg_catalog.current_setting('backbeat.booking_payment_history_target', true);
  expected_id text;
  expected_environment text;
BEGIN
  IF target = 'development' THEN
    expected_id := 'backbeat-dev'; expected_environment := 'development';
  ELSIF target = 'hosted:hupkygptbvnzrihrlcxv' THEN
    expected_id := 'backbeat-staging'; expected_environment := 'staging';
  ELSE
    RAISE EXCEPTION 'PAYMENT_HISTORY_010_TARGET_NOT_EXPLICIT';
  END IF;
  IF pg_catalog.to_regclass('public.runtime_environment') IS NULL THEN
    RAISE EXCEPTION 'PAYMENT_HISTORY_010_MARKER_MISSING';
  END IF;
  IF (SELECT pg_catalog.count(*) FROM public.runtime_environment) <> 1 OR NOT EXISTS (
    SELECT 1 FROM public.runtime_environment
    WHERE id = expected_id AND environment = expected_environment AND synthetic_only IS TRUE
  ) THEN
    RAISE EXCEPTION 'PAYMENT_HISTORY_010_MARKER_MISMATCH';
  END IF;
  IF pg_catalog.to_regclass('public.booking_payments') IS NULL OR (SELECT pg_catalog.count(*)
      FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'booking_payments'
        AND column_name IN ('voided_at', 'void_kind', 'void_reason', 'replaces_payment_id')) <> 4 THEN
    RAISE EXCEPTION 'PAYMENT_HISTORY_010_NOT_PRESENT';
  END IF;
  LOCK TABLE public.booking_payments IN SHARE ROW EXCLUSIVE MODE;
  IF EXISTS (SELECT 1 FROM public.booking_payments
      WHERE void_kind IS NOT NULL OR replaces_payment_id IS NOT NULL) THEN
    RAISE EXCEPTION 'PAYMENT_HISTORY_010_ROLLBACK_HAS_HISTORY';
  END IF;
END
$guard$;

DROP TRIGGER booking_payments_zz_guard_record ON public.booking_payments;
DROP TRIGGER booking_payments_history_mark_corrected ON public.booking_payments;
DROP TRIGGER booking_payments_history_insert ON public.booking_payments;
DROP FUNCTION public.backbeat_guard_booking_payment_record();
DROP FUNCTION public.backbeat_booking_payment_mark_corrected();
DROP FUNCTION public.backbeat_booking_payment_history_insert();
ALTER TABLE public.booking_payments
  DROP CONSTRAINT booking_payments_replaces_key,
  DROP CONSTRAINT booking_payments_replaces_fkey,
  DROP CONSTRAINT booking_payments_replaces_not_self_check,
  DROP CONSTRAINT booking_payments_void_reason_check,
  DROP CONSTRAINT booking_payments_void_set_check,
  DROP CONSTRAINT booking_payments_void_kind_check,
  DROP COLUMN replaces_payment_id,
  DROP COLUMN void_reason,
  DROP COLUMN void_kind,
  DROP COLUMN voided_at;
NOTIFY pgrst, 'reload schema';
COMMIT;
