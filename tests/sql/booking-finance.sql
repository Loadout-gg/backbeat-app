-- SQL contract test for migration 007 (booking finance), its ops files and its rollback.
-- Run through tests/sql/run-local.sh on a throwaway local cluster; never on a hosted database.
\set ON_ERROR_STOP on
\ir local-stub.sql
\ir ../../migrations/001_development_schema.sql
\ir ../../migrations/002_booking_venue_primary_contact.sql
\ir ../../migrations/003_access_foundation.sql
SET backbeat.booking_fee_target = 'development';
\ir ../../migrations/004_booking_fee.sql
SET backbeat.booking_lifecycle_target = 'development';
\ir ../../migrations/005_booking_workspace_key.sql
\ir ../../migrations/006_booking_lifecycle.sql

-- Fixtures: two workspaces, one active member and one artist each.
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('a0000000-0000-4000-8000-000000000001', 'a@example.test', now()),
  ('b0000000-0000-4000-8000-000000000001', 'b@example.test', now());
INSERT INTO public.workspaces (id, name, created_by) VALUES
  ('a0000000-0000-4000-8000-0000000000aa', 'Workspace A', 'a0000000-0000-4000-8000-000000000001'),
  ('b0000000-0000-4000-8000-0000000000bb', 'Workspace B', 'b0000000-0000-4000-8000-000000000001');
INSERT INTO public.workspace_members (workspace_id, user_id, role, status) VALUES
  ('a0000000-0000-4000-8000-0000000000aa', 'a0000000-0000-4000-8000-000000000001', 'admin', 'active'),
  ('b0000000-0000-4000-8000-0000000000bb', 'b0000000-0000-4000-8000-000000000001', 'admin', 'active');
INSERT INTO public.artists (id, workspace_id, name) VALUES
  ('a0000000-0000-4000-8000-00000000a471', 'a0000000-0000-4000-8000-0000000000aa', 'Artist A'),
  ('b0000000-0000-4000-8000-00000000b471', 'b0000000-0000-4000-8000-0000000000bb', 'Artist B');
INSERT INTO public.bookings (id, workspace_id, artist_id, date, start_time, fee_amount_minor, fee_currency) VALUES
  ('a0000000-0000-4000-8000-0000000b0001', 'a0000000-0000-4000-8000-0000000000aa', 'a0000000-0000-4000-8000-00000000a471', '2030-05-01', '21:00', 100000, 'EUR'),
  ('a0000000-0000-4000-8000-0000000b0002', 'a0000000-0000-4000-8000-0000000000aa', 'a0000000-0000-4000-8000-00000000a471', '2030-05-02', '21:00', NULL, NULL),
  ('a0000000-0000-4000-8000-0000000b0003', 'a0000000-0000-4000-8000-0000000000aa', 'a0000000-0000-4000-8000-00000000a471', '2030-05-03', '21:00', 500000, 'JPY'),
  ('b0000000-0000-4000-8000-0000000b0001', 'b0000000-0000-4000-8000-0000000000bb', 'b0000000-0000-4000-8000-00000000b471', '2030-05-01', '21:00', 100000, 'EUR');
CREATE TABLE bb_test.before AS SELECT id, to_jsonb(b) AS row FROM public.bookings AS b;
CREATE TABLE bb_test.artists_before AS SELECT id, to_jsonb(a) AS row FROM public.artists AS a;

-- The read-only preflight must execute before 007 and report readiness.
\ir ../../ops/supabase/booking-finance/preflight.sql
\set preflight `sed -e 's/;[[:space:]]*$//' ../../ops/supabase/booking-finance/preflight.sql`
SELECT bb_test.eq('preflight: ready, nothing applied',
  (SELECT string_agg(detail, ' | ' ORDER BY item) FROM (:preflight) AS p
   WHERE item IN ('ready for 007', '007 objects present', 'runtime_environment marker class')),
  '0/11 | READY_FOR_007 | development');

-- Guard: no explicit target, the production ref and the lifecycle setting are refused.
\set ON_ERROR_STOP off
\o /dev/null
\ir ../../migrations/007_booking_finance.sql
SET backbeat.booking_finance_target = 'hosted:jttrznlbbjyufzyqmzzs';
\ir ../../migrations/007_booking_finance.sql
SET backbeat.booking_finance_target = 'hosted:hupkygptbvnzrihrlcxv';
\ir ../../migrations/007_booking_finance.sql
\ir ../../ops/supabase/booking-finance/rollback.sql
\o
\set ON_ERROR_STOP on
SELECT bb_test.eq('guard: refused targets add nothing',
  coalesce(to_regclass('public.booking_payments')::text, 'absent') || ':' ||
  (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name IN ('bookings', 'artists')
   AND column_name IN ('commission_type', 'default_commission_type', 'tax_note'))::text
  || ':' || coalesce(to_regclass('public.booking_payments_rollback_backup')::text, 'no-backup'), 'absent:0:no-backup');

SET backbeat.booking_finance_target = 'development';
\ir ../../migrations/007_booking_finance.sql
\ir ../../ops/supabase/booking-finance/007-forward-payment-history.sql

SELECT bb_test.eq('existing rows: bookings untouched, no backfill',
  (SELECT count(*)::text FROM public.bookings AS b JOIN bb_test.before AS o USING (id)
   WHERE to_jsonb(b) - ARRAY['commission_type', 'commission_value', 'commission_mode', 'tax_note'] = o.row
     AND b.commission_type IS NULL AND b.commission_value IS NULL AND b.commission_mode IS NULL AND b.tax_note IS NULL), '4');
SELECT bb_test.eq('existing rows: artists untouched, no backfill',
  (SELECT count(*)::text FROM public.artists AS a JOIN bb_test.artists_before AS o USING (id)
   WHERE to_jsonb(a) - ARRAY['default_commission_type', 'default_commission_value', 'default_commission_mode', 'default_commission_currency'] = o.row
     AND a.default_commission_type IS NULL AND a.default_commission_value IS NULL
     AND a.default_commission_mode IS NULL AND a.default_commission_currency IS NULL), '2');
SELECT bb_test.eq('schema: booking policy set unchanged',
  (SELECT string_agg(policyname || ':' || cmd, ',' ORDER BY policyname) FROM pg_policies
   WHERE schemaname = 'public' AND tablename IN ('bookings', 'artists')), 'artist_access:ALL,booking_access:ALL');

-- The postflight must execute and pass on the migrated schema.
\ir ../../ops/supabase/booking-finance/postflight.sql
\set postflight `sed -e 's/;[[:space:]]*$//' ../../ops/supabase/booking-finance/postflight.sql`
SELECT bb_test.eq('postflight: every check passes',
  (SELECT string_agg(result || ' ' || detail, '') FROM (:postflight) AS p WHERE ord = 99), 'ALL PASS 15/15');
SELECT bb_test.eq('postflight: no failing row',
  (SELECT coalesce(string_agg(item, '; '), 'none') FROM (:postflight) AS p WHERE result <> 'PASS' AND ord <> 99), 'none');

-- verify.sql: every check passes and nothing is left behind.
\ir ../../ops/supabase/booking-finance/verify.sql
SELECT bb_test.eq('verify.sql: 22 PASS lines, no FAIL or SKIP',
  (SELECT count(*) FILTER (WHERE line LIKE 'PASS|%')::text || ':' || count(*) FILTER (WHERE line NOT LIKE 'PASS|%')::text
   FROM unnest(string_to_array(current_setting('backbeat.finance_verify_report'), E'\n')) AS line), '22:0');
SELECT bb_test.eq('verify.sql: leaves no payment and no changed booking',
  (SELECT count(*)::text FROM public.booking_payments) || ':' ||
  (SELECT count(*)::text FROM public.bookings AS b JOIN bb_test.before AS o USING (id)
   WHERE to_jsonb(b) - ARRAY['commission_type', 'commission_value', 'commission_mode', 'tax_note'] = o.row
     AND b.commission_type IS NULL AND b.tax_note IS NULL), '0:4');
SELECT bb_test.eq('verify.sql: leaves no artist default',
  (SELECT count(*)::text FROM public.artists WHERE default_commission_type IS NOT NULL OR default_commission_currency IS NOT NULL), '0');
SELECT bb_test.eq('verify.sql: session role restored', current_user::text, 'postgres');

DO $$
DECLARE
  ua uuid := 'a0000000-0000-4000-8000-000000000001';
  ub uuid := 'b0000000-0000-4000-8000-000000000001';
  wa uuid := 'a0000000-0000-4000-8000-0000000000aa';
  wb uuid := 'b0000000-0000-4000-8000-0000000000bb';
  aa uuid := 'a0000000-0000-4000-8000-00000000a471';
  eur uuid := 'a0000000-0000-4000-8000-0000000b0001';
  nofee uuid := 'a0000000-0000-4000-8000-0000000b0002';
  jpy uuid := 'a0000000-0000-4000-8000-0000000b0003';
  other_ws uuid := 'b0000000-0000-4000-8000-0000000b0001';
  ins text := 'INSERT INTO public.booking_payments (workspace_id, booking_id, kind, amount_minor, currency%s) VALUES (%L, %L, %L, %s, %L%s)';
  payment uuid; outcome text;
BEGIN
  -- Payments: currency rule, amount, kind, note.
  PERFORM bb_test.eq('payment: deposit in the fee currency', bb_test.run_as(ua, format(ins, ', due_on', wa, eur, 'deposit', 30000, 'EUR', ', ''2030-04-01''')), 'OK:1');
  PERFORM bb_test.eq('payment: balance in the fee currency', bb_test.run_as(ua, format(ins, '', wa, eur, 'balance', 70000, 'EUR', '')), 'OK:1');
  PERFORM bb_test.eq('payment: another currency rejected', bb_test.run_as(ua, format(ins, '', wa, eur, 'other', 100, 'USD', '')), 'BB004');
  PERFORM bb_test.eq('payment: booking without fee rejected', bb_test.run_as(ua, format(ins, '', wa, nofee, 'deposit', 100, 'EUR', '')), 'BB004');
  PERFORM bb_test.eq('payment: JPY booking takes JPY', bb_test.run_as(ua, format(ins, '', wa, jpy, 'deposit', 150000, 'JPY', '')), 'OK:1');
  PERFORM bb_test.eq('payment: JPY booking rejects EUR', bb_test.run_as(ua, format(ins, '', wa, jpy, 'deposit', 150000, 'EUR', '')), 'BB004');
  PERFORM bb_test.eq('payment: zero amount rejected', bb_test.run_as(ua, format(ins, '', wa, eur, 'other', 0, 'EUR', '')), '23514');
  PERFORM bb_test.eq('payment: negative amount rejected', bb_test.run_as(ua, format(ins, '', wa, eur, 'other', -5, 'EUR', '')), '23514');
  PERFORM bb_test.eq('payment: amount above the maximum rejected', bb_test.run_as(ua, format(ins, '', wa, eur, 'other', 1000000000000, 'EUR', '')), '23514');
  PERFORM bb_test.eq('payment: unknown kind rejected', bb_test.run_as(ua, format(ins, '', wa, eur, 'refund', 100, 'EUR', '')), '23514');
  PERFORM bb_test.eq('payment: note of 500 characters', bb_test.run_as(ua, format(ins, ', note', wa, eur, 'other', 100, 'EUR', format(', %L', repeat('n', 500)))), 'OK:1');
  PERFORM bb_test.eq('payment: note of 501 characters rejected', bb_test.run_as(ua, format(ins, ', note', wa, eur, 'other', 100, 'EUR', format(', %L', repeat('n', 501)))), '23514');
  PERFORM bb_test.eq('payment: unknown booking is a foreign key violation', bb_test.run_as(ua, format(ins, '', wa, gen_random_uuid(), 'other', 100, 'EUR', '')), '23503');

  SELECT id INTO payment FROM public.booking_payments WHERE booking_id = eur AND kind = 'deposit';
  PERFORM bb_test.eq('payment: mark as paid', bb_test.run_as(ua, format('UPDATE public.booking_payments SET paid_on = ''2030-04-02'' WHERE id = %L', payment)), 'OK:1');
  PERFORM bb_test.eq('payment: paid_on stored', (SELECT paid_on::text FROM public.booking_payments WHERE id = payment), '2030-04-02');
  PERFORM bb_test.eq('payment: paid date cannot be cleared', bb_test.run_as(ua, format('UPDATE public.booking_payments SET paid_on = NULL WHERE id = %L', payment)), 'BB006');
  PERFORM bb_test.eq('payment: paid amount cannot be overwritten', bb_test.run_as(ua, format('UPDATE public.booking_payments SET amount_minor = 1 WHERE id = %L', payment)), 'BB006');
  PERFORM bb_test.eq('payment: currency update rejected', bb_test.run_as(ua, format('UPDATE public.booking_payments SET currency = ''USD'' WHERE id = %L', payment)), 'BB004');
  PERFORM bb_test.eq('payment: moving to a booking in another currency rejected', bb_test.run_as(ua, format('UPDATE public.booking_payments SET booking_id = %L WHERE id = %L', jpy, payment)), 'BB004');

  -- Fee: amount editable, currency locked while payments exist (decision 6).
  PERFORM bb_test.eq('fee: amount change with payments', bb_test.run_as(ua, format('UPDATE public.bookings SET fee_amount_minor = 120000 WHERE id = %L', eur)), 'OK:1');
  PERFORM bb_test.eq('fee: currency change with payments rejected', bb_test.run_as(ua, format('UPDATE public.bookings SET fee_currency = ''USD'' WHERE id = %L', eur)), 'BB005');
  PERFORM bb_test.eq('fee: clearing with payments rejected', bb_test.run_as(ua, format('UPDATE public.bookings SET fee_amount_minor = NULL, fee_currency = NULL WHERE id = %L', eur)), 'BB005');
  PERFORM bb_test.eq('fee: stored currency unchanged', (SELECT fee_currency || ':' || fee_amount_minor FROM public.bookings WHERE id = eur), 'EUR:120000');
  PERFORM bb_test.eq('fee: currency change without payments', bb_test.run_as(ua, format('UPDATE public.bookings SET fee_amount_minor = 100, fee_currency = ''GBP'' WHERE id = %L', nofee)), 'OK:1');

  -- No coupling with the booking status or date (decisions 7 and 8).
  PERFORM bb_test.eq('status: confirm with payments', bb_test.run_as(ua, format('UPDATE public.bookings SET status = ''confirmed'' WHERE id = %L', eur)), 'OK:1');
  PERFORM bb_test.eq('status: cancel keeps payments', bb_test.run_as(ua, format('UPDATE public.bookings SET status = ''cancelled'' WHERE id = %L', eur)), 'OK:1');
  PERFORM bb_test.eq('status: payment on a cancelled booking', bb_test.run_as(ua, format(ins, '', wa, eur, 'other', 500, 'EUR', '')), 'OK:1');
  PERFORM bb_test.eq('date: move keeps payments', bb_test.run_as(ua, format('UPDATE public.bookings SET date = ''2031-01-01'' WHERE id = %L', eur)), 'OK:1');
  PERFORM bb_test.eq('payments: all kept', (SELECT count(*)::text FROM public.booking_payments WHERE booking_id = eur), '4');

  -- Hard delete blocked by the foreign key (decision 8), also through the artist cascade.
  PERFORM bb_test.eq('delete: booking with payments rejected', bb_test.run_as(ua, format('DELETE FROM public.bookings WHERE id = %L', eur)), '23503');
  PERFORM bb_test.eq('delete: artist of a booking with payments rejected', bb_test.run_as(ua, format('DELETE FROM public.artists WHERE id = %L', aa)), '23503');
  PERFORM bb_test.eq('delete: booking without payments', bb_test.run_as(ua, format('DELETE FROM public.bookings WHERE id = %L', nofee)), 'OK:1');

  -- updated_at is maintained by the shared trigger.
  PERFORM bb_test.run_as(ua, format('UPDATE public.booking_payments SET updated_at = ''2000-01-01'' WHERE id = %L', payment));
  PERFORM bb_test.eq('payment: updated_at is set by the trigger, not by the writer',
    (SELECT (updated_at > '2001-01-01')::text FROM public.booking_payments WHERE id = payment), 'true');

  -- Commission and tax note on bookings (decisions 5 and 10).
  PERFORM bb_test.eq('commission: percent on top', bb_test.run_as(ua, format('UPDATE public.bookings SET commission_type = ''percent'', commission_value = 1500, commission_mode = ''on_top'' WHERE id = %L', eur)), 'OK:1');
  PERFORM bb_test.eq('commission: 100 percent included', bb_test.run_as(ua, format('UPDATE public.bookings SET commission_value = 10000, commission_mode = ''included'' WHERE id = %L', eur)), 'OK:1');
  PERFORM bb_test.eq('commission: above 100 percent rejected', bb_test.run_as(ua, format('UPDATE public.bookings SET commission_value = 10001 WHERE id = %L', eur)), '23514');
  PERFORM bb_test.eq('commission: negative rejected', bb_test.run_as(ua, format('UPDATE public.bookings SET commission_value = -1 WHERE id = %L', eur)), '23514');
  PERFORM bb_test.eq('commission: unknown type rejected', bb_test.run_as(ua, format('UPDATE public.bookings SET commission_type = ''tiered'' WHERE id = %L', eur)), '23514');
  PERFORM bb_test.eq('commission: unknown mode rejected', bb_test.run_as(ua, format('UPDATE public.bookings SET commission_mode = ''split'' WHERE id = %L', eur)), '23514');
  PERFORM bb_test.eq('commission: value without type rejected', bb_test.run_as(ua, format('UPDATE public.bookings SET commission_type = NULL WHERE id = %L', eur)), '23514');
  PERFORM bb_test.eq('commission: missing mode rejected', bb_test.run_as(ua, format('UPDATE public.bookings SET commission_mode = NULL WHERE id = %L', eur)), '23514');
  PERFORM bb_test.eq('commission: fixed included up to the fee', bb_test.run_as(ua, format('UPDATE public.bookings SET commission_type = ''fixed'', commission_value = 120000, commission_mode = ''included'' WHERE id = %L', eur)), 'OK:1');
  PERFORM bb_test.eq('commission: fixed included above the fee rejected', bb_test.run_as(ua, format('UPDATE public.bookings SET commission_value = 120001 WHERE id = %L', eur)), '23514');
  PERFORM bb_test.eq('commission: fee lowered below an included fixed commission rejected', bb_test.run_as(ua, format('UPDATE public.bookings SET fee_amount_minor = 100 WHERE id = %L', eur)), '23514');
  PERFORM bb_test.eq('commission: fixed on top may exceed the fee', bb_test.run_as(ua, format('UPDATE public.bookings SET commission_value = 999999999999, commission_mode = ''on_top'' WHERE id = %L', eur)), 'OK:1');
  PERFORM bb_test.eq('commission: fixed above the maximum rejected', bb_test.run_as(ua, format('UPDATE public.bookings SET commission_value = 1000000000000 WHERE id = %L', eur)), '23514');
  PERFORM bb_test.eq('commission: cleared together', bb_test.run_as(ua, format('UPDATE public.bookings SET commission_type = NULL, commission_value = NULL, commission_mode = NULL WHERE id = %L', eur)), 'OK:1');
  PERFORM bb_test.eq('tax note: 2000 characters', bb_test.run_as(ua, format('UPDATE public.bookings SET tax_note = %L WHERE id = %L', repeat('t', 2000), eur)), 'OK:1');
  PERFORM bb_test.eq('tax note: 2001 characters rejected', bb_test.run_as(ua, format('UPDATE public.bookings SET tax_note = %L WHERE id = %L', repeat('t', 2001), eur)), '23514');

  -- Artist default commission (decisions 5, 12, 13): type, value and mode together;
  -- a currency of its own exactly when the type is fixed.
  PERFORM bb_test.eq('artist default: percent with mode', bb_test.run_as(ua, format('UPDATE public.artists SET default_commission_type = ''percent'', default_commission_value = 1250, default_commission_mode = ''included'' WHERE id = %L', aa)), 'OK:1');
  PERFORM bb_test.eq('artist default: above 100 percent rejected', bb_test.run_as(ua, format('UPDATE public.artists SET default_commission_value = 10001 WHERE id = %L', aa)), '23514');
  PERFORM bb_test.eq('artist default: percent with a currency rejected', bb_test.run_as(ua, format('UPDATE public.artists SET default_commission_currency = ''EUR'' WHERE id = %L', aa)), '23514');
  PERFORM bb_test.eq('artist default: mode cleared alone rejected', bb_test.run_as(ua, format('UPDATE public.artists SET default_commission_mode = NULL WHERE id = %L', aa)), '23514');
  PERFORM bb_test.eq('artist default: unknown mode rejected', bb_test.run_as(ua, format('UPDATE public.artists SET default_commission_mode = ''split'' WHERE id = %L', aa)), '23514');
  PERFORM bb_test.eq('artist default: fixed without currency rejected', bb_test.run_as(ua, format('UPDATE public.artists SET default_commission_type = ''fixed'', default_commission_value = 25000 WHERE id = %L', aa)), '23514');
  PERFORM bb_test.eq('artist default: fixed with an unknown currency rejected', bb_test.run_as(ua, format('UPDATE public.artists SET default_commission_type = ''fixed'', default_commission_value = 25000, default_commission_currency = ''CHF'' WHERE id = %L', aa)), '23514');
  PERFORM bb_test.eq('artist default: fixed in JPY, whole yen', bb_test.run_as(ua, format('UPDATE public.artists SET default_commission_type = ''fixed'', default_commission_value = 30000, default_commission_mode = ''on_top'', default_commission_currency = ''JPY'' WHERE id = %L', aa)), 'OK:1');
  PERFORM bb_test.eq('artist default: fixed in EUR', bb_test.run_as(ua, format('UPDATE public.artists SET default_commission_value = 25000, default_commission_currency = ''EUR'' WHERE id = %L', aa)), 'OK:1');
  PERFORM bb_test.eq('artist default: fixed above the maximum rejected', bb_test.run_as(ua, format('UPDATE public.artists SET default_commission_value = 1000000000000 WHERE id = %L', aa)), '23514');
  PERFORM bb_test.eq('artist default: currency cleared on a fixed default rejected', bb_test.run_as(ua, format('UPDATE public.artists SET default_commission_currency = NULL WHERE id = %L', aa)), '23514');
  PERFORM bb_test.eq('artist default: type without value rejected', bb_test.run_as(ua, format('UPDATE public.artists SET default_commission_value = NULL WHERE id = %L', aa)), '23514');
  PERFORM bb_test.eq('artist default: unknown type rejected', bb_test.run_as(ua, format('UPDATE public.artists SET default_commission_type = ''tiered'' WHERE id = %L', aa)), '23514');
  PERFORM bb_test.eq('artist default: currency alone rejected', bb_test.run_as(ub, format('UPDATE public.artists SET default_commission_currency = ''EUR'' WHERE id = %L', 'b0000000-0000-4000-8000-00000000b471')), '23514');
  PERFORM bb_test.eq('artist default: stored row', (SELECT default_commission_type || ':' || default_commission_value || ':' || default_commission_mode || ':' || default_commission_currency FROM public.artists WHERE id = aa), 'fixed:25000:on_top:EUR');
  PERFORM bb_test.eq('artist default: outsider cannot change it', bb_test.run_as(ub, format('UPDATE public.artists SET default_commission_value = 1 WHERE id = %L', aa)), 'OK:0');

  -- Workspace isolation: user B is not a member of workspace A (decision 9, AC4).
  PERFORM bb_test.run_as(ub, 'CREATE TEMP TABLE seen AS SELECT count(*) AS n FROM public.booking_payments');
  PERFORM bb_test.eq('rls: outsider sees no payment', (SELECT n::text FROM seen), '0');
  PERFORM bb_test.eq('rls: outsider cannot update', bb_test.run_as(ub, format('UPDATE public.booking_payments SET amount_minor = 1 WHERE id = %L', payment)), 'OK:0');
  PERFORM bb_test.eq('grants: outsider cannot delete', bb_test.run_as(ub, format('DELETE FROM public.booking_payments WHERE id = %L', payment)), '42501');
  PERFORM bb_test.eq('rls: outsider cannot insert into workspace A', bb_test.run_as(ub, format(ins, '', wa, eur, 'other', 100, 'EUR', '')), '42501');
  PERFORM bb_test.eq('fk: own workspace with a booking of another workspace rejected', bb_test.run_as(ub, format(ins, '', wb, eur, 'other', 100, 'EUR', '')), '23503');
  PERFORM bb_test.eq('rls: outsider can use the own workspace', bb_test.run_as(ub, format(ins, '', wb, other_ws, 'deposit', 100, 'EUR', '')), 'OK:1');
  PERFORM bb_test.eq('payment: parent/workspace cannot change', bb_test.run_as(ua, format('UPDATE public.booking_payments SET workspace_id = %L, booking_id = %L WHERE id = %L', wb, other_ws, payment)), 'BB006');
  PERFORM bb_test.eq('rls: signed-out caller is rejected', bb_test.run_as(NULL, format(ins, '', wa, eur, 'other', 100, 'EUR', '')), '42501');
  PERFORM bb_test.eq('payments: stored rows after the isolation checks', (SELECT count(*)::text FROM public.booking_payments WHERE workspace_id = wa), '5');

  -- Inactive membership loses access.
  UPDATE public.workspace_members SET status = 'inactive' WHERE workspace_id = wa AND user_id = ua;
  PERFORM bb_test.eq('rls: inactive member cannot insert', bb_test.run_as(ua, format(ins, '', wa, eur, 'other', 100, 'EUR', '')), '42501');
  PERFORM bb_test.eq('rls: inactive member cannot update', bb_test.run_as(ua, format('UPDATE public.booking_payments SET amount_minor = 1 WHERE id = %L', payment)), 'OK:0');
  UPDATE public.workspace_members SET status = 'active' WHERE workspace_id = wa AND user_id = ua;

  -- anon has no privilege on the table.
  BEGIN
    SET LOCAL ROLE anon;
    PERFORM count(*) FROM public.booking_payments;
    outcome := 'readable';
  EXCEPTION WHEN OTHERS THEN outcome := SQLSTATE;
  END;
  RESET ROLE;
  PERFORM bb_test.eq('grants: anon cannot read payments', outcome, '42501');

  PERFORM bb_test.eq('payment: active member cannot hard-delete', bb_test.run_as(ua, format('DELETE FROM public.booking_payments WHERE booking_id = %L', eur)), '42501');
  PERFORM bb_test.eq('payment: hard-delete denial retains all rows', (SELECT count(*)::text FROM public.booking_payments WHERE booking_id = eur), '4');
END
$$;
SELECT bb_test.eq('grants: API role privileges on booking_payments',
  (has_table_privilege('authenticated', 'public.booking_payments', 'SELECT') AND
   has_table_privilege('authenticated', 'public.booking_payments', 'INSERT') AND
   has_table_privilege('authenticated', 'public.booking_payments', 'UPDATE'))::text || ':' ||
  (has_table_privilege('anon', 'public.booking_payments', 'SELECT, DELETE') OR has_table_privilege('authenticated', 'public.booking_payments', 'DELETE, TRUNCATE'))::text, 'true:false');
SELECT bb_test.eq('schema: trigger functions not callable by API roles',
  (has_function_privilege('authenticated', 'public.backbeat_enforce_payment_currency()', 'EXECUTE')
   OR has_function_privilege('anon', 'public.backbeat_enforce_booking_fee_currency()', 'EXECUTE'))::text, 'false');

-- Deleting a whole workspace still works with payments present: its cascade removes the
-- payments in the same statement, before the RESTRICT check of the bookings runs.
-- (Undone here so the rollback checks below keep their rows.)
DO $$
DECLARE outcome text;
BEGIN
  BEGIN
    DELETE FROM public.workspaces WHERE id = 'a0000000-0000-4000-8000-0000000000aa';
    outcome := 'deleted';
    RAISE EXCEPTION 'BB_UNDO';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'BB_UNDO' THEN outcome := SQLSTATE; END IF;
  END;
  PERFORM bb_test.eq('workspace delete with payments still cascades', outcome, 'deleted');
END
$$;

-- Private fixture cleanup only, to keep the original two-row rollback oracle independent.
DELETE FROM public.booking_payments WHERE booking_id = 'a0000000-0000-4000-8000-0000000b0001';
DELETE FROM public.bookings WHERE id = 'a0000000-0000-4000-8000-0000000b0001';
-- Rollback: backs up, removes the 007 schema and forward trigger, and is re-runnable.
UPDATE public.bookings SET commission_type = 'percent', commission_value = 1000, commission_mode = 'included', tax_note = 'VAT reverse charge'
  WHERE id = 'a0000000-0000-4000-8000-0000000b0003';
\ir ../../ops/supabase/booking-finance/rollback.sql
\ir ../../ops/supabase/booking-finance/rollback.sql
SELECT bb_test.eq('rollback: 007 schema removed',
  coalesce(to_regclass('public.booking_payments')::text, 'absent') || ':' ||
  (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name IN ('bookings', 'artists')
   AND column_name IN ('commission_type', 'commission_value', 'commission_mode', 'tax_note', 'default_commission_type', 'default_commission_value', 'default_commission_mode', 'default_commission_currency'))::text
  || ':' || (SELECT count(*) FROM pg_proc WHERE proname IN ('backbeat_enforce_payment_currency', 'backbeat_enforce_booking_fee_currency', 'backbeat_guard_booking_payment_history'))::text
  || ':' || (SELECT count(*) FROM pg_trigger WHERE tgname = 'bookings_enforce_fee_currency')::text, 'absent:0:0:0');
SELECT bb_test.eq('rollback: payments backed up',
  (SELECT count(*)::text FROM public.booking_payments_rollback_backup), '2');
SELECT bb_test.eq('rollback: commission, tax note and artist default backed up',
  (SELECT string_agg(source || ':' || commission_type || ':' || commission_value || ':' || coalesce(commission_mode, '-') || ':' || coalesce(commission_currency, '-') || ':' || coalesce(tax_note, '-'), ',' ORDER BY source)
   FROM public.booking_finance_rollback_backup), 'artist:fixed:25000:on_top:EUR:-,booking:percent:1000:included:-:VAT reverse charge');
SELECT bb_test.eq('rollback: backups invisible to API roles',
  (has_table_privilege('authenticated', 'public.booking_payments_rollback_backup', 'SELECT')
   OR has_table_privilege('authenticated', 'public.booking_finance_rollback_backup', 'SELECT')
   OR has_table_privilege('anon', 'public.booking_payments_rollback_backup', 'SELECT'))::text
  || ':' || (SELECT bool_and(relrowsecurity)::text FROM pg_class
     WHERE relname IN ('booking_payments_rollback_backup', 'booking_finance_rollback_backup')), 'false:true');
SELECT bb_test.eq('rollback: lifecycle trigger and booking rows kept',
  (SELECT count(*)::text FROM pg_trigger WHERE tgname = 'bookings_enforce_status') || ':' || (SELECT count(*)::text FROM public.bookings), '1:2');
\ir ../../migrations/007_booking_finance.sql
\ir ../../ops/supabase/booking-finance/007-forward-payment-history.sql
SELECT bb_test.eq('clean install after fixture rollback: schema back, tables empty',
  (SELECT count(*)::text FROM public.booking_payments) || ':' ||
  (SELECT count(*)::text FROM public.bookings WHERE commission_type IS NOT NULL), '0:0');

-- A later rollback refreshes the backup of rows that still exist and keeps the others.
UPDATE public.bookings SET commission_type = 'fixed', commission_value = 2000, commission_mode = 'on_top'
  WHERE id = 'a0000000-0000-4000-8000-0000000b0003';
INSERT INTO public.booking_payments (id, workspace_id, booking_id, kind, amount_minor, currency)
  SELECT id, workspace_id, booking_id, kind, 777, currency FROM public.booking_payments_rollback_backup
  WHERE booking_id = 'a0000000-0000-4000-8000-0000000b0003';
\ir ../../ops/supabase/booking-finance/rollback.sql
SELECT bb_test.eq('rollback again: live values replace the older backup, missing rows keep theirs',
  (SELECT string_agg(source || ':' || commission_type || ':' || commission_value || ':' || coalesce(commission_mode, '-') || ':' || coalesce(commission_currency, '-') || ':' || coalesce(tax_note, '-'), ',' ORDER BY source)
   FROM public.booking_finance_rollback_backup)
  || ' | ' || (SELECT string_agg(amount_minor::text, ',' ORDER BY amount_minor) FROM public.booking_payments_rollback_backup),
  'artist:fixed:25000:on_top:EUR:-,booking:fixed:2000:on_top:-:- | 100,777');

-- Guard: a production-shaped database (no marker table) refuses 007 whatever the setting.
ALTER TABLE public.runtime_environment RENAME TO runtime_environment_real;
SET backbeat.booking_finance_target = 'hosted:hupkygptbvnzrihrlcxv';
\set ON_ERROR_STOP off
\o /dev/null
\ir ../../migrations/007_booking_finance.sql
\o
\set ON_ERROR_STOP on
SELECT bb_test.eq('guard: no marker table refused',
  coalesce(to_regclass('public.booking_payments')::text, 'absent'), 'absent');
-- A staging marker is accepted only with the staging target.
CREATE TABLE public.runtime_environment (id text, environment text, synthetic_only boolean);
INSERT INTO public.runtime_environment VALUES ('backbeat-staging', 'staging', true);
SET backbeat.booking_finance_target = 'development';
\set ON_ERROR_STOP off
\o /dev/null
\ir ../../migrations/007_booking_finance.sql
\o
\set ON_ERROR_STOP on
SELECT bb_test.eq('guard: staging marker with the development target refused',
  coalesce(to_regclass('public.booking_payments')::text, 'absent'), 'absent');
SET backbeat.booking_finance_target = 'hosted:hupkygptbvnzrihrlcxv';
\ir ../../migrations/007_booking_finance.sql
SELECT bb_test.eq('guard: staging marker with the staging target applies',
  coalesce(to_regclass('public.booking_payments')::text, 'absent'), 'booking_payments');
\echo BOOKING_FINANCE_SQL_TESTS_PASSED
