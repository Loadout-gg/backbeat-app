-- Forward candidate for an installed 007 with DELETE containment already in place.
-- For a fresh schema, run the corrected 007 once before this file. Do not apply on a
-- hosted target without owner approval of these exact bytes and the rollout order.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '15s';
DO $guard$
DECLARE
  target text := pg_catalog.current_setting('backbeat.booking_finance_target', true);
  expected_id text;
  expected_environment text;
BEGIN
  IF target = 'development' THEN
    expected_id := 'backbeat-dev'; expected_environment := 'development';
  ELSIF target = 'hosted:hupkygptbvnzrihrlcxv' THEN
    IF pg_catalog.current_database() <> 'postgres' OR
      (SELECT system_identifier::text FROM pg_catalog.pg_control_system()) IS DISTINCT FROM '7702071863184491885' THEN
      RAISE EXCEPTION 'PAYMENT_HISTORY_WRONG_CLUSTER';
    END IF;
    expected_id := 'backbeat-staging'; expected_environment := 'staging';
  ELSE
    RAISE EXCEPTION 'PAYMENT_HISTORY_TARGET_NOT_EXPLICIT';
  END IF;
  IF pg_catalog.to_regclass('public.runtime_environment') IS NULL THEN
    RAISE EXCEPTION 'PAYMENT_HISTORY_MARKER_MISSING';
  END IF;
  IF (SELECT pg_catalog.count(*) FROM public.runtime_environment) <> 1 OR NOT EXISTS (
    SELECT 1 FROM public.runtime_environment
    WHERE id = expected_id AND environment = expected_environment AND synthetic_only IS TRUE
  ) THEN
    RAISE EXCEPTION 'PAYMENT_HISTORY_MARKER_MISMATCH';
  END IF;
  -- Serialize ACL/DDL changes with precondition checking and trigger installation.
  LOCK TABLE public.booking_payments IN SHARE ROW EXCLUSIVE MODE;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class WHERE oid = 'public.booking_payments'::pg_catalog.regclass AND relrowsecurity)
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policy WHERE polrelid = 'public.booking_payments'::pg_catalog.regclass
      AND polname = 'booking_payment_access' AND polcmd = '*')
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid = 'public.booking_payments'::pg_catalog.regclass
      AND conname = 'booking_payments_pkey' AND contype = 'p') THEN
    RAISE EXCEPTION 'PAYMENT_HISTORY_REQUIRES_007';
  END IF;
  IF NOT (pg_catalog.has_table_privilege('authenticated', 'public.booking_payments', 'SELECT')
    AND pg_catalog.has_table_privilege('authenticated', 'public.booking_payments', 'INSERT')
    AND pg_catalog.has_table_privilege('authenticated', 'public.booking_payments', 'UPDATE'))
    OR pg_catalog.has_table_privilege('authenticated', 'public.booking_payments', 'DELETE, TRUNCATE')
    OR pg_catalog.has_table_privilege('anon', 'public.booking_payments', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE') THEN
    RAISE EXCEPTION 'PAYMENT_HISTORY_ACL_MISMATCH';
  END IF;
END
$guard$;

CREATE FUNCTION public.backbeat_guard_booking_payment_history()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $function$
BEGIN
  -- Keep the retry key and its original parent stable. No change to membership or policy.
  IF ROW(NEW.id, NEW.workspace_id, NEW.booking_id, NEW.created_at)
     IS DISTINCT FROM ROW(OLD.id, OLD.workspace_id, OLD.booking_id, OLD.created_at) THEN
    RAISE EXCEPTION 'BOOKING_PAYMENT_HISTORY_RESERVED' USING ERRCODE = 'BB006';
  END IF;
  IF OLD.paid_on IS NOT NULL THEN
    IF ROW(NEW.kind, NEW.amount_minor, NEW.currency, NEW.due_on, NEW.paid_on, NEW.note)
       IS DISTINCT FROM ROW(OLD.kind, OLD.amount_minor, OLD.currency, OLD.due_on, OLD.paid_on, OLD.note) THEN
      RAISE EXCEPTION 'BOOKING_PAYMENT_HISTORY_RESERVED' USING ERRCODE = 'BB006';
    END IF;
    -- The normal timestamp trigger runs first; a paid replay is a semantic no-op.
    NEW.updated_at := OLD.updated_at;
  END IF;
  RETURN NEW;
END
$function$;
REVOKE ALL ON FUNCTION public.backbeat_guard_booking_payment_history() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER booking_payments_z_guard_history BEFORE UPDATE ON public.booking_payments
  FOR EACH ROW EXECUTE FUNCTION public.backbeat_guard_booking_payment_history();

-- No data rewrite, role grant, RLS change or delete/cascade trigger.
COMMIT;
