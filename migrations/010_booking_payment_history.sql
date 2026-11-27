-- Booking payment history (#33, decided by Simone 2026-11-25): payments are never hard-deleted
-- from the app. A void (e.g. the event was cancelled) and a correction (the data changed) both
-- keep the original row as history. Numbered 010: 008 and 009 belong to #35 and #36.
-- Additive: four nullable columns, constraints and history triggers on booking_payments.
-- No row is rewritten or backfilled. No grant, role, policy or RLS change. Requires 007.
-- Works with or without ops/supabase/booking-finance/007-forward-payment-history.sql.
-- NOT APPLIED ANYWHERE. RESERVED (AGENTS.md, r03 point 3): Alberto approves these exact bytes,
-- the staging target and the order (after 007, before the app version that reads it) first.
-- Prefix with an explicit target:
--   SET backbeat.booking_payment_history_target = 'development';                 -- synthetic local
--   SET backbeat.booking_payment_history_target = 'hosted:hupkygptbvnzrihrlcxv'; -- staging
-- Production has no marker table and is not an allowed target of this file.
-- Rollback: ops/supabase/booking-finance/010-rollback.sql (refuses while history exists).
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
  IF pg_catalog.to_regclass('public.booking_payments') IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class
    WHERE oid = 'public.booking_payments'::pg_catalog.regclass AND relrowsecurity
  ) OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
      WHERE conrelid = 'public.booking_payments'::pg_catalog.regclass
        AND conname = 'booking_payments_workspace_id_id_key' AND contype = 'u') THEN
    RAISE EXCEPTION 'PAYMENT_HISTORY_010_REQUIRES_007';
  END IF;
  -- A booking with any payment row (incl. voided or corrected) can only be cancelled, never
  -- hard-deleted: the 007 composite FK must still be ON DELETE RESTRICT.
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
      WHERE conrelid = 'public.booking_payments'::pg_catalog.regclass
        AND conname = 'booking_payments_booking_fkey' AND contype = 'f' AND confdeltype = 'r'
        AND confrelid = 'public.bookings'::pg_catalog.regclass) THEN
    RAISE EXCEPTION 'PAYMENT_HISTORY_010_BOOKING_FK_NOT_RESTRICT';
  END IF;
  -- No hard delete from the app: refuse a shape where an ordinary session could delete.
  IF pg_catalog.has_table_privilege('authenticated', 'public.booking_payments', 'DELETE, TRUNCATE')
    OR pg_catalog.has_table_privilege('anon', 'public.booking_payments', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE') THEN
    RAISE EXCEPTION 'PAYMENT_HISTORY_010_ACL_MISMATCH';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'booking_payments'
        AND column_name IN ('voided_at', 'void_kind', 'void_reason', 'replaces_payment_id')) THEN
    RAISE EXCEPTION 'PAYMENT_HISTORY_010_ALREADY_PRESENT';
  END IF;
END
$guard$;

-- Serialize with concurrent payment writes while the shape changes.
LOCK TABLE public.booking_payments IN SHARE ROW EXCLUSIVE MODE;

-- void_kind 'void': no longer due (reason required). 'corrected': replaced by the row whose
-- replaces_payment_id names it. voided_at is set by the database, never by the writer.
ALTER TABLE public.booking_payments
  ADD COLUMN voided_at timestamptz,
  ADD COLUMN void_kind text,
  ADD COLUMN void_reason text,
  ADD COLUMN replaces_payment_id uuid,
  ADD CONSTRAINT booking_payments_void_kind_check CHECK (void_kind IN ('void', 'corrected')),
  ADD CONSTRAINT booking_payments_void_set_check CHECK ((voided_at IS NULL) = (void_kind IS NULL)),
  ADD CONSTRAINT booking_payments_void_reason_check CHECK (
    (void_reason IS NULL OR (void_kind IS NOT NULL AND pg_catalog.char_length(void_reason) BETWEEN 1 AND 500))
    AND (void_kind IS DISTINCT FROM 'void' OR void_reason IS NOT NULL)),
  ADD CONSTRAINT booking_payments_replaces_not_self_check CHECK (replaces_payment_id IS DISTINCT FROM id),
  -- Same workspace; an original can be corrected at most once and is never deleted under it.
  ADD CONSTRAINT booking_payments_replaces_fkey FOREIGN KEY (workspace_id, replaces_payment_id)
    REFERENCES public.booking_payments(workspace_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT booking_payments_replaces_key UNIQUE (workspace_id, replaces_payment_id);

-- SECURITY INVOKER: every function runs as the writer, under the writer's RLS.
-- SQLSTATE BB006 recorded payment history cannot be changed this way,
--          BB007 invalid correction (other booking, already voided or corrected) or void on insert.
CREATE FUNCTION public.backbeat_booking_payment_history_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $function$
DECLARE
  original_booking uuid;
  original_void text;
BEGIN
  IF NEW.voided_at IS NOT NULL OR NEW.void_kind IS NOT NULL OR NEW.void_reason IS NOT NULL THEN
    RAISE EXCEPTION 'BOOKING_PAYMENT_VOID_ON_INSERT' USING ERRCODE = 'BB007';
  END IF;
  IF NEW.replaces_payment_id IS NOT NULL THEN
    -- FOR UPDATE serializes two corrections of the same original.
    SELECT p.booking_id, p.void_kind INTO original_booking, original_void
      FROM public.booking_payments AS p
      WHERE p.workspace_id = NEW.workspace_id AND p.id = NEW.replaces_payment_id FOR UPDATE;
    IF NOT FOUND THEN
      RETURN NEW; -- left to the foreign key (23503) and to RLS
    END IF;
    IF original_booking IS DISTINCT FROM NEW.booking_id OR original_void IS NOT NULL THEN
      RAISE EXCEPTION 'BOOKING_PAYMENT_CORRECTION_INVALID' USING ERRCODE = 'BB007';
    END IF;
  END IF;
  RETURN NEW;
END
$function$;

CREATE FUNCTION public.backbeat_booking_payment_mark_corrected()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $function$
BEGIN
  -- Same statement as the replacement insert: both rows commit together or not at all.
  UPDATE public.booking_payments SET void_kind = 'corrected'
    WHERE workspace_id = NEW.workspace_id AND id = NEW.replaces_payment_id AND void_kind IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BOOKING_PAYMENT_CORRECTION_INVALID' USING ERRCODE = 'BB007';
  END IF;
  RETURN NULL;
END
$function$;

CREATE FUNCTION public.backbeat_guard_booking_payment_record()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $function$
BEGIN
  -- Identity, parent, amounts, dates other than a first paid date, and the note are history.
  IF ROW(NEW.id, NEW.workspace_id, NEW.booking_id, NEW.created_at, NEW.kind, NEW.amount_minor,
         NEW.currency, NEW.due_on, NEW.note, NEW.replaces_payment_id)
     IS DISTINCT FROM ROW(OLD.id, OLD.workspace_id, OLD.booking_id, OLD.created_at, OLD.kind,
         OLD.amount_minor, OLD.currency, OLD.due_on, OLD.note, OLD.replaces_payment_id) THEN
    RAISE EXCEPTION 'BOOKING_PAYMENT_HISTORY_RESERVED' USING ERRCODE = 'BB006';
  END IF;
  IF OLD.void_kind IS NOT NULL THEN
    -- A voided or corrected row is final; an identical replay is a no-op.
    IF ROW(NEW.paid_on, NEW.void_kind, NEW.void_reason, NEW.voided_at)
       IS DISTINCT FROM ROW(OLD.paid_on, OLD.void_kind, OLD.void_reason, OLD.voided_at) THEN
      RAISE EXCEPTION 'BOOKING_PAYMENT_HISTORY_RESERVED' USING ERRCODE = 'BB006';
    END IF;
    NEW.updated_at := OLD.updated_at;
    RETURN NEW;
  END IF;
  IF NEW.void_kind IS NOT NULL THEN
    IF NEW.paid_on IS DISTINCT FROM OLD.paid_on THEN
      RAISE EXCEPTION 'BOOKING_PAYMENT_HISTORY_RESERVED' USING ERRCODE = 'BB006';
    END IF;
    -- 'corrected' only together with its replacement (see the AFTER INSERT trigger).
    IF NEW.void_kind = 'corrected' AND NOT EXISTS (
      SELECT 1 FROM public.booking_payments AS p
      WHERE p.workspace_id = OLD.workspace_id AND p.replaces_payment_id = OLD.id
    ) THEN
      RAISE EXCEPTION 'BOOKING_PAYMENT_CORRECTION_INVALID' USING ERRCODE = 'BB007';
    END IF;
    NEW.voided_at := pg_catalog.now();
    NEW.updated_at := pg_catalog.now();
    RETURN NEW;
  END IF;
  IF NEW.void_reason IS NOT NULL OR NEW.voided_at IS NOT NULL THEN
    RAISE EXCEPTION 'BOOKING_PAYMENT_HISTORY_RESERVED' USING ERRCODE = 'BB006';
  END IF;
  -- The only ordinary change: a first paid date. A paid date is never changed or cleared.
  IF OLD.paid_on IS NOT NULL AND NEW.paid_on IS DISTINCT FROM OLD.paid_on THEN
    RAISE EXCEPTION 'BOOKING_PAYMENT_HISTORY_RESERVED' USING ERRCODE = 'BB006';
  END IF;
  RETURN NEW;
END
$function$;
REVOKE ALL ON FUNCTION public.backbeat_booking_payment_history_insert(),
  public.backbeat_booking_payment_mark_corrected(),
  public.backbeat_guard_booking_payment_record() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER booking_payments_history_insert BEFORE INSERT ON public.booking_payments
  FOR EACH ROW EXECUTE FUNCTION public.backbeat_booking_payment_history_insert();
CREATE TRIGGER booking_payments_history_mark_corrected AFTER INSERT ON public.booking_payments
  FOR EACH ROW WHEN (NEW.replaces_payment_id IS NOT NULL)
  EXECUTE FUNCTION public.backbeat_booking_payment_mark_corrected();
-- Named to run after booking_payments_updated_at and booking_payments_z_guard_history.
CREATE TRIGGER booking_payments_zz_guard_record BEFORE UPDATE ON public.booking_payments
  FOR EACH ROW EXECUTE FUNCTION public.backbeat_guard_booking_payment_record();

-- Grants, RLS and policies on booking_payments, bookings and artists are unchanged.
NOTIFY pgrst, 'reload schema';
COMMIT;
