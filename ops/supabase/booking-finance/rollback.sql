-- Rollback of migrations/007_booking_finance.sql. Redeploy the previous app version first;
-- the previous version also runs unchanged on the 007 schema, so this file is needed only
-- to remove the schema itself. Lossy for the live tables: payments, commissions, tax notes
-- and artist default commissions are removed. They are first copied to
-- booking_payments_rollback_backup and booking_finance_rollback_backup (RLS on, no grants,
-- no policies: invisible to the API). Re-running is safe: a later rollback overwrites the
-- backup of a row that still exists with its current values and keeps the backup of rows
-- that are already gone. Same explicit target as 007.
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
  IF pg_catalog.to_regclass('public.bookings') IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class
    WHERE oid = pg_catalog.to_regclass('public.bookings') AND relrowsecurity
  ) THEN
    RAISE EXCEPTION 'BOOKING_FINANCE_BOOKINGS_RLS_REQUIRED';
  END IF;
END
$guard$;
CREATE TABLE IF NOT EXISTS public.booking_payments_rollback_backup (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  booking_id uuid NOT NULL,
  kind text NOT NULL,
  amount_minor bigint NOT NULL,
  currency text NOT NULL,
  due_on date,
  paid_on date,
  note text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  backed_up_at timestamptz NOT NULL DEFAULT pg_catalog.now()
);
CREATE TABLE IF NOT EXISTS public.booking_finance_rollback_backup (
  source text NOT NULL CHECK (source IN ('booking', 'artist')),
  id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  commission_type text,
  commission_value bigint,
  commission_mode text,
  tax_note text,
  backed_up_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  PRIMARY KEY (source, id)
);
ALTER TABLE public.booking_payments_rollback_backup ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.booking_finance_rollback_backup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.booking_payments_rollback_backup,
  public.booking_finance_rollback_backup FROM PUBLIC, anon, authenticated;

DO $backup$
BEGIN
  IF pg_catalog.to_regclass('public.booking_payments') IS NOT NULL THEN
    INSERT INTO public.booking_payments_rollback_backup
        (id, workspace_id, booking_id, kind, amount_minor, currency, due_on, paid_on, note, created_at, updated_at)
      SELECT id, workspace_id, booking_id, kind, amount_minor, currency, due_on, paid_on, note, created_at, updated_at
      FROM public.booking_payments
      ON CONFLICT (id) DO UPDATE SET workspace_id = EXCLUDED.workspace_id, booking_id = EXCLUDED.booking_id,
        kind = EXCLUDED.kind, amount_minor = EXCLUDED.amount_minor, currency = EXCLUDED.currency,
        due_on = EXCLUDED.due_on, paid_on = EXCLUDED.paid_on, note = EXCLUDED.note,
        created_at = EXCLUDED.created_at, updated_at = EXCLUDED.updated_at, backed_up_at = pg_catalog.now();
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
      AND table_name = 'bookings' AND column_name = 'commission_type') THEN
    INSERT INTO public.booking_finance_rollback_backup
        (source, id, workspace_id, commission_type, commission_value, commission_mode, tax_note)
      SELECT 'booking', id, workspace_id, commission_type, commission_value, commission_mode, tax_note
      FROM public.bookings WHERE commission_type IS NOT NULL OR tax_note IS NOT NULL
      ON CONFLICT (source, id) DO UPDATE SET workspace_id = EXCLUDED.workspace_id,
        commission_type = EXCLUDED.commission_type, commission_value = EXCLUDED.commission_value,
        commission_mode = EXCLUDED.commission_mode, tax_note = EXCLUDED.tax_note, backed_up_at = pg_catalog.now();
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
      AND table_name = 'artists' AND column_name = 'default_commission_type') THEN
    INSERT INTO public.booking_finance_rollback_backup
        (source, id, workspace_id, commission_type, commission_value)
      SELECT 'artist', id, workspace_id, default_commission_type, default_commission_value
      FROM public.artists WHERE default_commission_type IS NOT NULL
      ON CONFLICT (source, id) DO UPDATE SET workspace_id = EXCLUDED.workspace_id,
        commission_type = EXCLUDED.commission_type, commission_value = EXCLUDED.commission_value,
        backed_up_at = pg_catalog.now();
  END IF;
END
$backup$;

DROP TRIGGER IF EXISTS bookings_enforce_fee_currency ON public.bookings;
DROP TABLE IF EXISTS public.booking_payments;
DROP FUNCTION IF EXISTS public.backbeat_enforce_payment_currency();
DROP FUNCTION IF EXISTS public.backbeat_enforce_booking_fee_currency();
ALTER TABLE public.bookings
  DROP CONSTRAINT IF EXISTS bookings_commission_type_check,
  DROP CONSTRAINT IF EXISTS bookings_commission_mode_check,
  DROP CONSTRAINT IF EXISTS bookings_commission_set_check,
  DROP CONSTRAINT IF EXISTS bookings_commission_value_check,
  DROP CONSTRAINT IF EXISTS bookings_commission_within_fee_check,
  DROP CONSTRAINT IF EXISTS bookings_tax_note_check,
  DROP COLUMN IF EXISTS commission_type,
  DROP COLUMN IF EXISTS commission_value,
  DROP COLUMN IF EXISTS commission_mode,
  DROP COLUMN IF EXISTS tax_note;
ALTER TABLE public.artists
  DROP CONSTRAINT IF EXISTS artists_default_commission_type_check,
  DROP CONSTRAINT IF EXISTS artists_default_commission_set_check,
  DROP CONSTRAINT IF EXISTS artists_default_commission_value_check,
  DROP COLUMN IF EXISTS default_commission_type,
  DROP COLUMN IF EXISTS default_commission_value;
NOTIFY pgrst, 'reload schema';
COMMIT;
