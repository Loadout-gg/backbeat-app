-- SQL contract test for migrations 007 + 010 (finance, payment history) together with 008
-- (booking -> event): delete rules, cancellation and SQLSTATE ranges. Run through
-- tests/sql/run-booking-event.sh on a throwaway local cluster; never on a hosted database.
-- psql variable apply_order: 'numeric' (001..010 in file order) or 'staging' (010 before 008,
-- the order used on the staging database on 2026-11-27).
\set ON_ERROR_STOP on
\if :{?apply_order}
\else
\set apply_order numeric
\endif
\ir local-stub.sql
\ir ../../migrations/001_development_schema.sql
\ir ../../migrations/002_booking_venue_primary_contact.sql
\ir ../../migrations/003_access_foundation.sql
SET backbeat.booking_fee_target = 'development';
\ir ../../migrations/004_booking_fee.sql
SET backbeat.booking_lifecycle_target = 'development';
\ir ../../migrations/005_booking_workspace_key.sql
\ir ../../migrations/006_booking_lifecycle.sql
SET backbeat.booking_finance_target = 'development';
\ir ../../migrations/007_booking_finance.sql
\ir ../../ops/supabase/booking-finance/007-forward-payment-history.sql
SET backbeat.booking_event_target = 'development';
SET backbeat.booking_payment_history_target = 'development';
SELECT :'apply_order' = 'staging' AS staging_order \gset
\if :staging_order
\ir ../../migrations/010_booking_payment_history.sql
\ir ../../migrations/008_booking_event.sql
\else
\ir ../../migrations/008_booking_event.sql
\ir ../../migrations/010_booking_payment_history.sql
\endif

-- Both postflights still pass with the other migration installed.
\set postflight `sed -e 's/;[[:space:]]*$//' ../../ops/supabase/booking-event/postflight.sql`
SELECT bb_test.eq('008 postflight with 007 + 010',
  (SELECT string_agg(result || ' ' || detail, '') FROM (:postflight) AS p WHERE ord = 99), 'ALL PASS 20/20');

INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('a0000000-0000-4000-8000-000000000001', 'a@example.test', now());
INSERT INTO public.workspaces (id, name, created_by) VALUES
  ('a0000000-0000-4000-8000-0000000000aa', 'Workspace A', 'a0000000-0000-4000-8000-000000000001');
INSERT INTO public.workspace_members (workspace_id, user_id, role, status) VALUES
  ('a0000000-0000-4000-8000-0000000000aa', 'a0000000-0000-4000-8000-000000000001', 'admin', 'active');
INSERT INTO public.artists (id, workspace_id, name) VALUES
  ('a0000000-0000-4000-8000-00000000a471', 'a0000000-0000-4000-8000-0000000000aa', 'Artist A');

DO $test$
DECLARE
  ua constant uuid := 'a0000000-0000-4000-8000-000000000001';
  wa constant uuid := 'a0000000-0000-4000-8000-0000000000aa';
  aa constant uuid := 'a0000000-0000-4000-8000-00000000a471';
  both_id uuid; pay_only uuid; event_only uuid; free uuid; pay uuid;
  status text;
BEGIN
  both_id := bb_test.seed(wa, aa, 'confirmed', '2030-06-01');
  pay_only := bb_test.seed(wa, aa, 'confirmed', '2030-06-02');
  event_only := bb_test.seed(wa, aa, 'confirmed', '2030-06-03');
  free := bb_test.seed(wa, aa, 'confirmed', '2030-06-04');
  UPDATE public.bookings SET fee_amount_minor = 100000, fee_currency = 'EUR' WHERE workspace_id = wa;
  INSERT INTO public.events (workspace_id, title, date, status, booking_id) VALUES
    (wa, 'with payments', '2030-06-01', 'confirmed', both_id),
    (wa, 'without payments', '2030-06-03', 'confirmed', event_only);
  INSERT INTO public.booking_payments (workspace_id, booking_id, kind, amount_minor, currency, paid_on) VALUES
    (wa, both_id, 'deposit', 30000, 'EUR', '2030-05-01'),
    (wa, pay_only, 'deposit', 30000, 'EUR', NULL);

  -- Delete rules: the BEFORE DELETE trigger (BB011) answers before the payments RESTRICT FK.
  PERFORM bb_test.eq('event + payments: delete refused with BB011',
    bb_test.run_as(ua, format('DELETE FROM public.bookings WHERE id = %L', both_id)), 'BB011');
  status := bb_test.run_as(ua, format('DELETE FROM public.bookings WHERE id = %L', pay_only));
  PERFORM bb_test.eq('payments only: delete refused by the RESTRICT FK',
    (status IN ('23503', '23001'))::text, 'true');
  BEGIN
    DELETE FROM public.bookings WHERE id = pay_only;
    RAISE EXCEPTION 'payments-only delete not refused';
  EXCEPTION WHEN foreign_key_violation OR restrict_violation THEN
    PERFORM bb_test.eq('payments only: FK named in the error',
      (SQLERRM LIKE '%booking_payments_booking_fkey%')::text, 'true');
  END;
  PERFORM bb_test.eq('event only: delete refused with BB011',
    bb_test.run_as(ua, format('DELETE FROM public.bookings WHERE id = %L', event_only)), 'BB011');
  PERFORM bb_test.eq('no event, no payments: delete allowed',
    bb_test.run_as(ua, format('DELETE FROM public.bookings WHERE id = %L', free)), 'OK:1');
  PERFORM bb_test.eq('refused deletes keep bookings, events and payments',
    (SELECT count(*)::text FROM public.bookings WHERE workspace_id = wa) || ':'
      || (SELECT count(*)::text FROM public.events WHERE booking_id IS NOT NULL) || ':'
      || (SELECT count(*)::text FROM public.booking_payments WHERE voided_at IS NULL), '3:2:2');

  -- Cancellation: the event follows the booking; payments are independent and untouched.
  PERFORM bb_test.eq('cancel booking with event + payments',
    bb_test.run_as(ua, format('UPDATE public.bookings SET status = ''cancelled'' WHERE id = %L', both_id)), 'OK:1');
  PERFORM bb_test.eq('event cancelled with its booking',
    (SELECT e.status FROM public.events AS e WHERE e.booking_id = both_id), 'cancelled');
  PERFORM bb_test.eq('payments untouched by the cancellation',
    (SELECT count(*)::text FROM public.booking_payments WHERE booking_id = both_id AND voided_at IS NULL AND void_kind IS NULL), '1');
  SELECT id INTO pay FROM public.booking_payments WHERE booking_id = both_id;
  PERFORM bb_test.eq('payment of a cancelled booking can be voided',
    bb_test.run_as(ua, format('UPDATE public.booking_payments SET void_kind = ''void'', void_reason = ''Event cancelled'' WHERE id = %L', pay)), 'OK:1');
  PERFORM bb_test.eq('payment history kept, still blocks hard delete',
    bb_test.run_as(ua, format('DELETE FROM public.bookings WHERE id = %L', both_id)), 'BB011');
  PERFORM bb_test.eq('event stays cancelled after the void',
    (SELECT e.status FROM public.events AS e WHERE e.booking_id = both_id), 'cancelled');
END
$test$;

-- SQLSTATE ranges: 007/010 use BB004-BB007, 008 uses BB008-BB011; no code is shared.
SELECT bb_test.eq('SQLSTATE ranges are disjoint', (
  WITH codes AS (
    SELECT p.proname, (regexp_matches(pg_get_functiondef(p.oid), 'ERRCODE = ''(BB[0-9]{3})''', 'g'))[1] AS code
    FROM pg_proc AS p WHERE p.pronamespace = 'public'::regnamespace AND p.prokind = 'f'
  ), owner AS (
    SELECT code, CASE WHEN proname IN ('backbeat_enforce_event_booking', 'backbeat_cancel_booking_event',
      'backbeat_keep_cancelled_event', 'backbeat_keep_booking_with_event') THEN '008' ELSE 'other' END AS src
    FROM codes
  )
  SELECT coalesce(string_agg(DISTINCT code, ',' ORDER BY code), 'none') FROM owner AS o
  WHERE src = '008' AND (code NOT BETWEEN 'BB008' AND 'BB011'
    OR EXISTS (SELECT 1 FROM owner AS x WHERE x.code = o.code AND x.src = 'other'))
), 'none');
SELECT bb_test.eq('008 codes present', (
  SELECT string_agg(DISTINCT m[1], ',' ORDER BY m[1]) FROM pg_proc AS p,
    regexp_matches(pg_get_functiondef(p.oid), 'ERRCODE = ''(BB[0-9]{3})''', 'g') AS m
  WHERE p.proname IN ('backbeat_enforce_event_booking', 'backbeat_cancel_booking_event',
    'backbeat_keep_cancelled_event', 'backbeat_keep_booking_with_event')), 'BB008,BB009,BB010,BB011');
\echo 'booking-event-finance: ALL PASS'
