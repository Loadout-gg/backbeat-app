-- SQL contract test for migration 010 (payment history: no hard delete, void, correction,
-- idempotent replay) and its rollback. Run through tests/sql/run-local.sh on a throwaway local
-- cluster; never on a hosted database.
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
SET backbeat.booking_finance_target = 'development';
\ir ../../migrations/007_booking_finance.sql
\ir ../../ops/supabase/booking-finance/007-forward-payment-history.sql

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
  ('a0000000-0000-4000-8000-0000000b0002', 'a0000000-0000-4000-8000-0000000000aa', 'a0000000-0000-4000-8000-00000000a471', '2030-05-02', '21:00', 100000, 'EUR'),
  ('b0000000-0000-4000-8000-0000000b0001', 'b0000000-0000-4000-8000-0000000000bb', 'b0000000-0000-4000-8000-00000000b471', '2030-05-01', '21:00', 100000, 'EUR');
-- A payment recorded before 010 must survive it unchanged.
INSERT INTO public.booking_payments (id, workspace_id, booking_id, kind, amount_minor, currency) VALUES
  ('a0000000-0000-4000-8000-00000000c000', 'a0000000-0000-4000-8000-0000000000aa', 'a0000000-0000-4000-8000-0000000b0001', 'deposit', 30000, 'EUR');
CREATE TABLE bb_test.before AS SELECT id, to_jsonb(p) AS row FROM public.booking_payments AS p;

-- Guard: no target, production ref, and a 007-less shape are refused.
\set ON_ERROR_STOP off
\o /dev/null
\ir ../../migrations/010_booking_payment_history.sql
SET backbeat.booking_payment_history_target = 'hosted:jttrznlbbjyufzyqmzzs';
\ir ../../migrations/010_booking_payment_history.sql
SET backbeat.booking_payment_history_target = 'hosted:hupkygptbvnzrihrlcxv';
\ir ../../migrations/010_booking_payment_history.sql
\o
\set ON_ERROR_STOP on
SELECT bb_test.eq('guard: refused targets add nothing',
  (SELECT count(*)::text FROM information_schema.columns WHERE table_schema = 'public'
   AND table_name = 'booking_payments' AND column_name IN ('voided_at', 'void_kind', 'void_reason', 'replaces_payment_id')), '0');

-- Guard: a DELETE grant to authenticated is refused (no hard delete from the app).
GRANT DELETE ON public.booking_payments TO authenticated;
SET backbeat.booking_payment_history_target = 'development';
\set ON_ERROR_STOP off
\o /dev/null
\ir ../../migrations/010_booking_payment_history.sql
\o
\set ON_ERROR_STOP on
REVOKE DELETE ON public.booking_payments FROM authenticated;
SELECT bb_test.eq('guard: delete grant refused',
  (SELECT count(*)::text FROM information_schema.columns WHERE table_schema = 'public'
   AND table_name = 'booking_payments' AND column_name = 'void_kind'), '0');

\ir ../../migrations/010_booking_payment_history.sql
SELECT bb_test.eq('apply: existing payment untouched',
  (SELECT count(*)::text FROM public.booking_payments AS p JOIN bb_test.before AS o USING (id)
   WHERE to_jsonb(p) - ARRAY['voided_at', 'void_kind', 'void_reason', 'replaces_payment_id'] = o.row
     AND p.voided_at IS NULL AND p.void_kind IS NULL AND p.void_reason IS NULL AND p.replaces_payment_id IS NULL), '1');
SELECT bb_test.eq('apply: grants unchanged',
  (SELECT string_agg(privilege_type, ',' ORDER BY privilege_type) FROM information_schema.role_table_grants
   WHERE table_schema = 'public' AND table_name = 'booking_payments' AND grantee = 'authenticated'), 'INSERT,SELECT,UPDATE');
SELECT bb_test.eq('apply: one policy, unchanged',
  (SELECT string_agg(polname || ':' || polcmd::text, ',') FROM pg_policy WHERE polrelid = 'public.booking_payments'::regclass),
  'booking_payment_access:*');
\set ON_ERROR_STOP off
\o /dev/null
\ir ../../migrations/010_booking_payment_history.sql
\o
\set ON_ERROR_STOP on

DO $test$
DECLARE
  ua uuid := 'a0000000-0000-4000-8000-000000000001';
  ub uuid := 'b0000000-0000-4000-8000-000000000001';
  wa uuid := 'a0000000-0000-4000-8000-0000000000aa';
  bk uuid := 'a0000000-0000-4000-8000-0000000b0001';
  bk2 uuid := 'a0000000-0000-4000-8000-0000000b0002';
  op uuid := 'a0000000-0000-4000-8000-00000000c001';
  fix uuid := 'a0000000-0000-4000-8000-00000000c002';
  fix2 uuid := 'a0000000-0000-4000-8000-00000000c003';
  paid uuid := 'a0000000-0000-4000-8000-00000000c004';
  ins text := 'INSERT INTO public.booking_payments (id, workspace_id, booking_id, kind, amount_minor, currency%s) VALUES (%L, %L, %L, %L, %s, ''EUR''%s)';
BEGIN
  -- Task 1: save -> response lost -> reload -> retry with the same key -> exactly one row.
  PERFORM bb_test.eq('retry: first save', bb_test.run_as(ua, format(ins, '', op, wa, bk, 'balance', 70000, '')), 'OK:1');
  PERFORM bb_test.eq('retry: same key is a duplicate, not a second row', bb_test.run_as(ua, format(ins, '', op, wa, bk, 'balance', 70000, '')), '23505');
  PERFORM bb_test.eq('retry: one row', (SELECT count(*)::text FROM public.booking_payments WHERE id = op), '1');

  -- No hard delete for any app session.
  PERFORM bb_test.eq('delete: member cannot delete', bb_test.run_as(ua, format('DELETE FROM public.booking_payments WHERE id = %L', op)), '42501');
  PERFORM bb_test.eq('delete: outsider cannot delete', bb_test.run_as(ub, format('DELETE FROM public.booking_payments WHERE id = %L', op)), '42501');

  -- Recorded data is history: no in-place edit.
  PERFORM bb_test.eq('history: amount edit rejected', bb_test.run_as(ua, format('UPDATE public.booking_payments SET amount_minor = 1 WHERE id = %L', op)), 'BB006');
  PERFORM bb_test.eq('history: note edit rejected', bb_test.run_as(ua, format('UPDATE public.booking_payments SET note = ''x'' WHERE id = %L', op)), 'BB006');
  PERFORM bb_test.eq('history: writer cannot set voided_at', bb_test.run_as(ua, format('UPDATE public.booking_payments SET voided_at = now() WHERE id = %L', op)), 'BB006');
  PERFORM bb_test.eq('history: corrected without replacement rejected', bb_test.run_as(ua, format('UPDATE public.booking_payments SET void_kind = ''corrected'' WHERE id = %L', op)), 'BB007');
  PERFORM bb_test.eq('history: void needs a reason', bb_test.run_as(ua, format('UPDATE public.booking_payments SET void_kind = ''void'' WHERE id = %L', op)), '23514');
  PERFORM bb_test.eq('insert: cannot insert voided', bb_test.run_as(ua, format(ins, ', void_kind, void_reason', fix2, wa, bk, 'other', 1, ', ''void'', ''x''')), 'BB007');

  -- Mark paid stays the one ordinary change; a paid date is then fixed.
  PERFORM bb_test.eq('paid: insert unpaid', bb_test.run_as(ua, format(ins, '', paid, wa, bk, 'other', 500, '')), 'OK:1');
  PERFORM bb_test.eq('paid: mark paid', bb_test.run_as(ua, format('UPDATE public.booking_payments SET paid_on = ''2030-04-02'' WHERE id = %L', paid)), 'OK:1');
  PERFORM bb_test.eq('paid: change paid date rejected', bb_test.run_as(ua, format('UPDATE public.booking_payments SET paid_on = ''2030-04-03'' WHERE id = %L', paid)), 'BB006');
  PERFORM bb_test.eq('paid: clear paid date rejected', bb_test.run_as(ua, format('UPDATE public.booking_payments SET paid_on = NULL WHERE id = %L', paid)), 'BB006');

  -- Void (e.g. event cancelled): the row stays, marked, timestamped by the database; final.
  PERFORM bb_test.eq('void: paid payment voided', bb_test.run_as(ua, format('UPDATE public.booking_payments SET void_kind = ''void'', void_reason = ''Event cancelled'' WHERE id = %L', paid)), 'OK:1');
  PERFORM bb_test.eq('void: row kept with timestamp', (SELECT void_kind || ':' || (voided_at IS NOT NULL) || ':' || paid_on FROM public.booking_payments WHERE id = paid), 'void:true:2030-04-02');
  PERFORM bb_test.eq('void: identical replay is a no-op', bb_test.run_as(ua, format('UPDATE public.booking_payments SET void_kind = ''void'', void_reason = ''Event cancelled'' WHERE id = %L', paid)), 'OK:1');
  PERFORM bb_test.eq('void: other reason rejected', bb_test.run_as(ua, format('UPDATE public.booking_payments SET void_reason = ''Other'' WHERE id = %L', paid)), 'BB006');
  PERFORM bb_test.eq('void: cannot be undone', bb_test.run_as(ua, format('UPDATE public.booking_payments SET void_kind = NULL, void_reason = NULL, voided_at = NULL WHERE id = %L', paid)), 'BB006');
  PERFORM bb_test.eq('void: voided cannot be corrected', bb_test.run_as(ua, format(ins, ', replaces_payment_id', fix2, wa, bk, 'other', 600, format(', %L', paid))), 'BB007');

  -- Correction (data changed): one statement adds the new row and marks the original.
  PERFORM bb_test.eq('correct: replacement saved', bb_test.run_as(ua, format(ins, ', replaces_payment_id', fix, wa, bk, 'balance', 65000, format(', %L', op))), 'OK:1');
  PERFORM bb_test.eq('correct: original kept as corrected', (SELECT void_kind || ':' || amount_minor || ':' || (voided_at IS NOT NULL) FROM public.booking_payments WHERE id = op), 'corrected:70000:true');
  PERFORM bb_test.eq('correct: replay of the same key adds nothing', bb_test.run_as(ua, format(ins, ', replaces_payment_id', fix, wa, bk, 'balance', 65000, format(', %L', op))), 'BB007');
  PERFORM bb_test.eq('correct: second correction of the original rejected', bb_test.run_as(ua, format(ins, ', replaces_payment_id', fix2, wa, bk, 'balance', 1, format(', %L', op))), 'BB007');
  PERFORM bb_test.eq('correct: rows for the booking', (SELECT count(*)::text FROM public.booking_payments WHERE booking_id = bk), '4');
  PERFORM bb_test.eq('correct: other booking rejected', bb_test.run_as(ua, format(ins, ', replaces_payment_id', fix2, wa, bk2, 'balance', 1, format(', %L', fix))), 'BB007');
  PERFORM bb_test.eq('correct: replacement can be corrected again', bb_test.run_as(ua, format(ins, ', replaces_payment_id', fix2, wa, bk, 'balance', 64000, format(', %L', fix))), 'OK:1');
  PERFORM bb_test.eq('correct: outsider cannot see or correct', bb_test.run_as(ub, format(ins, ', replaces_payment_id', 'b0000000-0000-4000-8000-00000000c009', wa, bk, 'balance', 1, format(', %L', fix2))), '42501');
  PERFORM bb_test.eq('rollback guard input: history present', (SELECT count(*)::text FROM public.booking_payments WHERE void_kind IS NOT NULL OR replaces_payment_id IS NOT NULL), '4');
END
$test$;

-- Rollback refuses while history exists; nothing is dropped.
\set ON_ERROR_STOP off
\o /dev/null
\ir ../../ops/supabase/booking-finance/010-rollback.sql
\o
\set ON_ERROR_STOP on
SELECT bb_test.eq('rollback: refused with history',
  (SELECT count(*)::text FROM information_schema.columns WHERE table_schema = 'public'
   AND table_name = 'booking_payments' AND column_name = 'void_kind'), '1');
-- Without history it removes exactly the 010 shape (fixture reset as the table owner).
DELETE FROM public.booking_payments WHERE id = 'a0000000-0000-4000-8000-00000000c003';
DELETE FROM public.booking_payments WHERE id = 'a0000000-0000-4000-8000-00000000c002';
DELETE FROM public.booking_payments WHERE id IN ('a0000000-0000-4000-8000-00000000c001', 'a0000000-0000-4000-8000-00000000c004');
\ir ../../ops/supabase/booking-finance/010-rollback.sql
SELECT bb_test.eq('rollback: 010 columns and functions removed',
  (SELECT count(*)::text FROM information_schema.columns WHERE table_schema = 'public'
   AND table_name = 'booking_payments' AND column_name IN ('voided_at', 'void_kind', 'void_reason', 'replaces_payment_id'))
  || ':' || coalesce(to_regprocedure('public.backbeat_guard_booking_payment_record()')::text, 'gone'), '0:gone');
SELECT bb_test.eq('rollback: original payment intact',
  (SELECT count(*)::text FROM public.booking_payments AS p JOIN bb_test.before AS o USING (id) WHERE to_jsonb(p) = o.row), '1');
\echo BOOKING_PAYMENT_HISTORY_SQL_TESTS_PASSED
