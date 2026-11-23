-- P2 of ARCH-20261114-booking-domain r02 (staging delegation, decisions of 2026-11-23).
-- Additive: booking_payments child table (RLS, grants, currency rule), agency commission and
-- tax note on bookings, default commission on artists. No row is rewritten, nothing is backfilled.
-- Idempotent: safe to re-run. Requires 004 and 005. Prefix with an explicit target:
--   SET backbeat.booking_finance_target = 'development';                 -- synthetic local
--   SET backbeat.booking_finance_target = 'hosted:hupkygptbvnzrihrlcxv'; -- staging
-- Each target must match its own synthetic marker row in public.runtime_environment;
-- production has no marker table. Production is not an allowed target of this file.
-- Rollback: ops/supabase/booking-finance/rollback.sql (see docs/booking-finance.md).
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '15s';
DO $guard$
DECLARE
  target text := pg_catalog.current_setting('backbeat.booking_finance_target', true);
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
    RAISE EXCEPTION 'BOOKING_FINANCE_TARGET_NOT_EXPLICIT';
  END IF;
  IF pg_catalog.to_regclass('public.runtime_environment') IS NULL THEN
    RAISE EXCEPTION 'BOOKING_FINANCE_SYNTHETIC_MARKER_MISSING';
  END IF;
  IF (SELECT pg_catalog.count(*) FROM public.runtime_environment) <> 1 OR NOT EXISTS (
    SELECT 1 FROM public.runtime_environment
    WHERE id = expected_id AND environment = expected_environment AND synthetic_only IS TRUE
  ) THEN
    RAISE EXCEPTION 'BOOKING_FINANCE_MARKER_DOES_NOT_MATCH_TARGET';
  END IF;
  IF pg_catalog.to_regprocedure('public.backbeat_is_active_member(uuid)') IS NULL
     OR pg_catalog.to_regprocedure('public.backbeat_touch_updated_at()') IS NULL
     OR pg_catalog.to_regclass('public.artists') IS NULL THEN
    RAISE EXCEPTION 'BOOKING_FINANCE_SHAPE_MISMATCH';
  END IF;
  IF pg_catalog.to_regclass('public.bookings') IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class
    WHERE oid = pg_catalog.to_regclass('public.bookings') AND relrowsecurity
  ) THEN
    RAISE EXCEPTION 'BOOKING_FINANCE_BOOKINGS_RLS_REQUIRED';
  END IF;
  IF (SELECT pg_catalog.count(*) FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'bookings'
        AND column_name IN ('fee_amount_minor', 'fee_currency')) <> 2 THEN
    RAISE EXCEPTION 'BOOKING_FINANCE_REQUIRES_004';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
      WHERE conrelid = 'public.bookings'::pg_catalog.regclass
        AND conname = 'bookings_workspace_id_id_key' AND contype = 'u') THEN
    RAISE EXCEPTION 'BOOKING_FINANCE_REQUIRES_005';
  END IF;
END
$guard$;

-- Agency commission per booking (decision 5) and the free-text tax note (decision 10).
-- commission_value is basis points for 'percent' (0..10000) and minor units of the booking
-- fee currency for 'fixed'. Nothing derived (totals, commission amount) is stored.
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS commission_type text,
  ADD COLUMN IF NOT EXISTS commission_value bigint,
  ADD COLUMN IF NOT EXISTS commission_mode text,
  ADD COLUMN IF NOT EXISTS tax_note text;
ALTER TABLE public.bookings
  DROP CONSTRAINT IF EXISTS bookings_commission_type_check,
  DROP CONSTRAINT IF EXISTS bookings_commission_mode_check,
  DROP CONSTRAINT IF EXISTS bookings_commission_set_check,
  DROP CONSTRAINT IF EXISTS bookings_commission_value_check,
  DROP CONSTRAINT IF EXISTS bookings_commission_within_fee_check,
  DROP CONSTRAINT IF EXISTS bookings_tax_note_check;
ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_commission_type_check
    CHECK (commission_type IN ('percent', 'fixed')),
  ADD CONSTRAINT bookings_commission_mode_check
    CHECK (commission_mode IN ('on_top', 'included')),
  ADD CONSTRAINT bookings_commission_set_check
    CHECK ((commission_type IS NULL) = (commission_value IS NULL)
       AND (commission_type IS NULL) = (commission_mode IS NULL)),
  ADD CONSTRAINT bookings_commission_value_check
    CHECK (commission_value BETWEEN 0 AND
      CASE WHEN commission_type = 'percent' THEN 10000 ELSE 999999999999 END),
  -- An included fixed commission cannot exceed the fee (artist net would be negative).
  ADD CONSTRAINT bookings_commission_within_fee_check
    CHECK (NOT (commission_type = 'fixed' AND commission_mode = 'included'
      AND fee_amount_minor IS NOT NULL AND commission_value > fee_amount_minor)),
  ADD CONSTRAINT bookings_tax_note_check
    CHECK (pg_catalog.char_length(tax_note) <= 2000);

-- Artist default commission: prefilled on new bookings by the application. A fixed default
-- has no currency of its own; it applies in the fee currency of each booking.
ALTER TABLE public.artists
  ADD COLUMN IF NOT EXISTS default_commission_type text,
  ADD COLUMN IF NOT EXISTS default_commission_value bigint;
ALTER TABLE public.artists
  DROP CONSTRAINT IF EXISTS artists_default_commission_type_check,
  DROP CONSTRAINT IF EXISTS artists_default_commission_set_check,
  DROP CONSTRAINT IF EXISTS artists_default_commission_value_check;
ALTER TABLE public.artists
  ADD CONSTRAINT artists_default_commission_type_check
    CHECK (default_commission_type IN ('percent', 'fixed')),
  ADD CONSTRAINT artists_default_commission_set_check
    CHECK ((default_commission_type IS NULL) = (default_commission_value IS NULL)),
  ADD CONSTRAINT artists_default_commission_value_check
    CHECK (default_commission_value BETWEEN 0 AND
      CASE WHEN default_commission_type = 'percent' THEN 10000 ELSE 999999999999 END);

-- Payments recorded by the agency (decisions 1, 4, 7). "Paid" is paid_on being set.
-- No column, CHECK or trigger links a payment to the booking status.
-- UNIQUE (workspace_id, id) is the same-workspace key for the receipt records of the next PR.
CREATE TABLE IF NOT EXISTS public.booking_payments (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  booking_id uuid NOT NULL,
  kind text NOT NULL,
  amount_minor bigint NOT NULL,
  currency text NOT NULL,
  due_on date,
  paid_on date,
  note text,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT booking_payments_workspace_id_id_key UNIQUE (workspace_id, id),
  CONSTRAINT booking_payments_kind_check CHECK (kind IN ('deposit', 'balance', 'other')),
  CONSTRAINT booking_payments_amount_minor_check CHECK (amount_minor BETWEEN 1 AND 999999999999),
  CONSTRAINT booking_payments_currency_check CHECK (currency IN ('EUR', 'USD', 'GBP', 'JPY')),
  CONSTRAINT booking_payments_note_check CHECK (pg_catalog.char_length(note) <= 500),
  -- Decision 8: a booking with payments cannot be hard-deleted (also blocks the artist cascade).
  CONSTRAINT booking_payments_booking_fkey FOREIGN KEY (workspace_id, booking_id)
    REFERENCES public.bookings(workspace_id, id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS booking_payments_workspace_booking_idx
  ON public.booking_payments(workspace_id, booking_id);

-- SECURITY INVOKER: both functions run as the writer, under the writer's RLS.
-- SQLSTATE BB004 payment currency differs from the booking fee currency (or no fee is set),
--          BB005 fee currency changed or cleared while payments exist.
CREATE OR REPLACE FUNCTION public.backbeat_enforce_payment_currency()
RETURNS trigger LANGUAGE plpgsql SET search_path = ''
AS $function$
DECLARE booking_currency text;
BEGIN
  -- FOR SHARE serializes against a concurrent fee-currency change of the same booking.
  SELECT b.fee_currency INTO booking_currency FROM public.bookings AS b
    WHERE b.workspace_id = NEW.workspace_id AND b.id = NEW.booking_id FOR SHARE;
  IF NOT FOUND THEN
    RETURN NEW; -- left to the foreign key (23503) and to RLS
  END IF;
  IF booking_currency IS NULL OR NEW.currency IS DISTINCT FROM booking_currency THEN
    RAISE EXCEPTION 'BOOKING_PAYMENT_CURRENCY_MUST_MATCH_FEE' USING ERRCODE = 'BB004';
  END IF;
  RETURN NEW;
END
$function$;
CREATE OR REPLACE FUNCTION public.backbeat_enforce_booking_fee_currency()
RETURNS trigger LANGUAGE plpgsql SET search_path = ''
AS $function$
BEGIN
  -- The fee amount stays editable; only a currency change (or clearing the fee) is blocked.
  IF NEW.fee_currency IS DISTINCT FROM OLD.fee_currency AND EXISTS (
    SELECT 1 FROM public.booking_payments AS p
    WHERE p.workspace_id = OLD.workspace_id AND p.booking_id = OLD.id
  ) THEN
    RAISE EXCEPTION 'BOOKING_FEE_CURRENCY_LOCKED_BY_PAYMENTS' USING ERRCODE = 'BB005';
  END IF;
  RETURN NEW;
END
$function$;
REVOKE ALL ON FUNCTION public.backbeat_enforce_payment_currency(),
  public.backbeat_enforce_booking_fee_currency() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS booking_payments_enforce_currency ON public.booking_payments;
CREATE TRIGGER booking_payments_enforce_currency BEFORE INSERT OR UPDATE ON public.booking_payments
  FOR EACH ROW EXECUTE FUNCTION public.backbeat_enforce_payment_currency();
DROP TRIGGER IF EXISTS booking_payments_updated_at ON public.booking_payments;
CREATE TRIGGER booking_payments_updated_at BEFORE UPDATE ON public.booking_payments
  FOR EACH ROW EXECUTE FUNCTION public.backbeat_touch_updated_at();
DROP TRIGGER IF EXISTS bookings_enforce_fee_currency ON public.bookings;
CREATE TRIGGER bookings_enforce_fee_currency BEFORE UPDATE ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.backbeat_enforce_booking_fee_currency();

-- Decision 9: same access shape as migration 001. Every active member, no role-specific policy.
ALTER TABLE public.booking_payments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.booking_payments FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.booking_payments TO authenticated;
DROP POLICY IF EXISTS booking_payment_access ON public.booking_payments;
CREATE POLICY booking_payment_access ON public.booking_payments FOR ALL TO authenticated
  USING (public.backbeat_is_active_member(workspace_id))
  WITH CHECK (public.backbeat_is_active_member(workspace_id));

-- RLS, grants and policies on bookings and artists are unchanged.
NOTIFY pgrst, 'reload schema';
COMMIT;
