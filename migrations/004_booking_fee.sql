BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '15s';
DO $guard$
DECLARE target text := current_setting('backbeat.booking_fee_target', true);
BEGIN
  IF target = 'development' THEN
    IF to_regclass('public.runtime_environment') IS NULL THEN
      RAISE EXCEPTION 'BOOKING_FEE_DEVELOPMENT_MARKER_MISSING';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.runtime_environment
      WHERE id = 'backbeat-dev' AND environment = 'development' AND synthetic_only = true
    ) OR (SELECT count(*) FROM public.runtime_environment) <> 1 THEN
      RAISE EXCEPTION 'BOOKING_FEE_DEVELOPMENT_MARKER_INVALID';
    END IF;
  ELSIF target = 'hosted:jttrznlbbjyufzyqmzzs' THEN
    IF to_regclass('public.runtime_environment') IS NOT NULL
       OR to_regprocedure('public.backbeat_is_active_member(uuid)') IS NULL THEN
      RAISE EXCEPTION 'BOOKING_FEE_HOSTED_SHAPE_MISMATCH';
    END IF;
  ELSE
    RAISE EXCEPTION 'BOOKING_FEE_TARGET_NOT_EXPLICIT';
  END IF;
  IF to_regclass('public.bookings') IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_class WHERE oid = 'public.bookings'::regclass AND relrowsecurity
  ) THEN
    RAISE EXCEPTION 'BOOKING_FEE_BOOKINGS_RLS_REQUIRED';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'bookings'
      AND column_name IN ('fee_amount_minor', 'fee_currency')
  ) THEN
    RAISE EXCEPTION 'BOOKING_FEE_ALREADY_OR_PARTIALLY_APPLIED';
  END IF;
END
$guard$;
ALTER TABLE public.bookings
  ADD COLUMN fee_amount_minor bigint,
  ADD COLUMN fee_currency text,
  ADD CONSTRAINT bookings_fee_amount_minor_check
    CHECK (fee_amount_minor BETWEEN 0 AND 999999999999),
  ADD CONSTRAINT bookings_fee_currency_check
    CHECK (fee_currency IN ('EUR', 'USD', 'GBP', 'JPY')),
  ADD CONSTRAINT bookings_fee_pair_check
    CHECK ((fee_amount_minor IS NULL) = (fee_currency IS NULL));
NOTIFY pgrst, 'reload schema';
COMMIT;
