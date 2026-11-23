-- SQL contract test for migrations 005/006 and their rollback/restore.
-- Run through tests/sql/run-local.sh on a throwaway local cluster; never on a hosted database.
\set ON_ERROR_STOP on
\ir local-stub.sql
\ir ../../migrations/001_development_schema.sql
\ir ../../migrations/002_booking_venue_primary_contact.sql
\ir ../../migrations/003_access_foundation.sql
SET backbeat.booking_fee_target = 'development';
\ir ../../migrations/004_booking_fee.sql

-- The read-only preflight must execute and classify the local marker.
\ir ../../ops/supabase/booking-lifecycle/preflight.sql

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
\set ua '''a0000000-0000-4000-8000-000000000001'''
\set ub '''b0000000-0000-4000-8000-000000000001'''
\set wa '''a0000000-0000-4000-8000-0000000000aa'''
\set wb '''b0000000-0000-4000-8000-0000000000bb'''
\set aa '''a0000000-0000-4000-8000-00000000a471'''
\set ab '''b0000000-0000-4000-8000-00000000b471'''

-- Rows that exist BEFORE the lifecycle migration: one per legacy status.
INSERT INTO public.bookings (workspace_id, artist_id, date, start_time, status, notes)
  SELECT :wa, :aa, '2030-05-01', '21:00', s, 'legacy-' || s
  FROM unnest(ARRAY['in_progress', 'confirmed', 'cancelled', 'completed']) AS s;
CREATE TABLE bb_test.before AS
  SELECT id, status, notes, date, updated_at FROM public.bookings;

-- Guard: no explicit target and the production ref are refused; nothing is applied.
-- (Each file's own COMMIT ends its aborted transaction as a rollback.)
\set ON_ERROR_STOP off
\o /dev/null
\ir ../../migrations/005_booking_workspace_key.sql
SET backbeat.booking_lifecycle_target = 'hosted:jttrznlbbjyufzyqmzzs';
\ir ../../migrations/005_booking_workspace_key.sql
\ir ../../migrations/006_booking_lifecycle.sql
\o
\set ON_ERROR_STOP on
SELECT bb_test.eq('guard: refused targets add nothing',
  ((SELECT count(*) FROM pg_constraint WHERE conname = 'bookings_workspace_id_id_key')
   + (SELECT count(*) FROM pg_proc WHERE proname = 'backbeat_enforce_booking_status'))::text, '0');

SET backbeat.booking_lifecycle_target = 'development';
\ir ../../migrations/005_booking_workspace_key.sql
\ir ../../migrations/006_booking_lifecycle.sql
-- Idempotency: a second run of both files must succeed and change nothing.
\ir ../../migrations/005_booking_workspace_key.sql
\ir ../../migrations/006_booking_lifecycle.sql

SELECT bb_test.eq('existing rows: untouched by 005/006',
  (SELECT count(*)::text FROM public.bookings b JOIN bb_test.before o USING (id)
   WHERE b.status = o.status AND b.notes = o.notes AND b.date = o.date
     AND b.updated_at = o.updated_at AND b.hold_expires_on IS NULL), '4');
SELECT bb_test.eq('schema: unique (workspace_id, id)',
  (SELECT count(*)::text FROM pg_constraint WHERE conrelid = 'public.bookings'::regclass
   AND conname = 'bookings_workspace_id_id_key' AND contype = 'u'), '1');
SELECT bb_test.eq('schema: exactly one status CHECK',
  (SELECT string_agg(conname, ',') FROM pg_constraint WHERE conrelid = 'public.bookings'::regclass
   AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%status%' AND conname <> 'bookings_hold_expires_on_check'),
  'bookings_status_check');
SELECT bb_test.eq('schema: one enforcement trigger',
  (SELECT count(*)::text FROM pg_trigger WHERE tgrelid = 'public.bookings'::regclass
   AND tgname = 'bookings_enforce_status' AND NOT tgisinternal), '1');
SELECT bb_test.eq('schema: booking policy set unchanged',
  (SELECT string_agg(policyname || ':' || cmd, ',' ORDER BY policyname) FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'bookings'), 'booking_access:ALL');
SELECT bb_test.eq('schema: trigger function not callable by API roles',
  (has_function_privilege('authenticated', 'public.backbeat_enforce_booking_status()', 'EXECUTE')
   OR has_function_privilege('anon', 'public.backbeat_enforce_booking_status()', 'EXECUTE'))::text, 'false');

-- Transition matrix as an ordinary member: all 36 pairs, allowed and rejected.
DO $$
DECLARE
  ua uuid := 'a0000000-0000-4000-8000-000000000001';
  wa uuid := 'a0000000-0000-4000-8000-0000000000aa';
  aa uuid := 'a0000000-0000-4000-8000-00000000a471';
  statuses text[] := ARRAY['in_progress', 'hold', 'option', 'confirmed', 'cancelled', 'completed'];
  allowed text[] := ARRAY[
    'in_progress>hold', 'in_progress>option', 'in_progress>confirmed', 'in_progress>cancelled',
    'hold>option', 'hold>confirmed', 'hold>cancelled', 'hold>in_progress',
    'option>confirmed', 'option>cancelled', 'option>hold',
    'confirmed>cancelled', 'confirmed>completed', 'cancelled>in_progress'];
  from_status text; to_status text; booking uuid; expected text;
BEGIN
  FOREACH from_status IN ARRAY statuses LOOP
    FOREACH to_status IN ARRAY statuses LOOP
      booking := bb_test.seed(wa, aa, from_status, '2020-01-01');
      expected := CASE WHEN from_status = to_status
        OR (from_status || '>' || to_status) = ANY (allowed) THEN 'OK:1' ELSE 'BB002' END;
      PERFORM bb_test.eq('matrix ' || from_status || ' -> ' || to_status,
        bb_test.run_as(ua, format('UPDATE public.bookings SET status = %L WHERE id = %L', to_status, booking)),
        expected);
      PERFORM bb_test.eq('matrix stored ' || from_status || ' -> ' || to_status,
        (SELECT status FROM public.bookings WHERE id = booking),
        CASE WHEN expected = 'OK:1' THEN to_status ELSE from_status END);
    END LOOP;
  END LOOP;
END
$$;

-- INSERT rule, completed-date rule, same-status edits, hold expiry.
DO $$
DECLARE
  ua uuid := 'a0000000-0000-4000-8000-000000000001';
  wa uuid := 'a0000000-0000-4000-8000-0000000000aa';
  aa uuid := 'a0000000-0000-4000-8000-00000000a471';
  ins text := 'INSERT INTO public.bookings (workspace_id, artist_id, date, start_time%s) VALUES (%L, %L, ''2030-01-01'', ''20:00''%s)';
  booking uuid; s text;
BEGIN
  PERFORM bb_test.eq('insert: default status', bb_test.run_as(ua, format(ins, '', wa, aa, '')), 'OK:1');
  PERFORM bb_test.eq('insert: explicit in_progress', bb_test.run_as(ua, format(ins, ', status', wa, aa, ', ''in_progress''')), 'OK:1');
  FOREACH s IN ARRAY ARRAY['hold', 'option', 'confirmed', 'cancelled', 'completed'] LOOP
    PERFORM bb_test.eq('insert: ' || s || ' rejected', bb_test.run_as(ua, format(ins, ', status', wa, aa, format(', %L', s))), 'BB001');
  END LOOP;
  PERFORM bb_test.eq('insert: unknown status still a CHECK violation', bb_test.run_as(ua, format(ins, ', status', wa, aa, ', ''pending''')), '23514');
  PERFORM bb_test.eq('insert: hold expiry without hold', bb_test.run_as(ua, format(ins, ', hold_expires_on', wa, aa, ', ''2030-01-01''')), '23514');

  booking := bb_test.seed(wa, aa, 'confirmed', CURRENT_DATE + 2);
  PERFORM bb_test.eq('completed: future date rejected', bb_test.run_as(ua, format('UPDATE public.bookings SET status = ''completed'' WHERE id = %L', booking)), 'BB003');
  booking := bb_test.seed(wa, aa, 'confirmed', CURRENT_DATE + 1);
  PERFORM bb_test.eq('completed: one-day zone tolerance', bb_test.run_as(ua, format('UPDATE public.bookings SET status = ''completed'' WHERE id = %L', booking)), 'OK:1');
  booking := bb_test.seed(wa, aa, 'confirmed', CURRENT_DATE);
  PERFORM bb_test.eq('completed: today', bb_test.run_as(ua, format('UPDATE public.bookings SET status = ''completed'' WHERE id = %L', booking)), 'OK:1');
  PERFORM bb_test.eq('completed: notes edit passes', bb_test.run_as(ua, format('UPDATE public.bookings SET notes = ''after show'' WHERE id = %L', booking)), 'OK:1');
  PERFORM bb_test.eq('completed: date to the future rejected', bb_test.run_as(ua, format('UPDATE public.bookings SET date = CURRENT_DATE + 30 WHERE id = %L', booking)), 'BB003');
  PERFORM bb_test.eq('completed: date to the past passes', bb_test.run_as(ua, format('UPDATE public.bookings SET date = CURRENT_DATE - 3 WHERE id = %L', booking)), 'OK:1');
  PERFORM bb_test.eq('completed: unknown status still a CHECK violation', bb_test.run_as(ua, format('UPDATE public.bookings SET status = ''pending'' WHERE id = %L', booking)), '23514');

  -- A legacy completed booking with a future date can still be edited while its date stays.
  booking := bb_test.seed(wa, aa, 'completed', CURRENT_DATE + 30);
  PERFORM bb_test.eq('completed legacy future: notes edit passes', bb_test.run_as(ua, format('UPDATE public.bookings SET notes = ''x'', venue_name = ''Club'' WHERE id = %L', booking)), 'OK:1');
  booking := bb_test.seed(wa, aa, 'cancelled', CURRENT_DATE + 30);
  PERFORM bb_test.eq('cancelled: notes and date edit passes', bb_test.run_as(ua, format('UPDATE public.bookings SET notes = ''x'', date = CURRENT_DATE + 31, status = ''cancelled'' WHERE id = %L', booking)), 'OK:1');

  booking := bb_test.seed(wa, aa, 'hold', '2030-01-01');
  PERFORM bb_test.eq('hold: expiry can be set', bb_test.run_as(ua, format('UPDATE public.bookings SET hold_expires_on = ''2029-12-01'' WHERE id = %L', booking)), 'OK:1');
  PERFORM bb_test.eq('hold: leaving hold clears expiry', bb_test.run_as(ua, format('UPDATE public.bookings SET status = ''option'' WHERE id = %L', booking)), 'OK:1');
  PERFORM bb_test.eq('hold: expiry cleared in storage', (SELECT coalesce(hold_expires_on::text, 'NULL') FROM public.bookings WHERE id = booking), 'NULL');
  PERFORM bb_test.eq('hold: expiry outside hold rejected', bb_test.run_as(ua, format('UPDATE public.bookings SET hold_expires_on = ''2029-12-01'' WHERE id = %L', booking)), '23514');
  PERFORM bb_test.eq('hold: status and expiry in one write', bb_test.run_as(ua, format('UPDATE public.bookings SET status = ''hold'', hold_expires_on = ''2029-12-02'' WHERE id = %L', booking)), 'OK:1');
  PERFORM bb_test.eq('hold: expiry stored', (SELECT hold_expires_on::text FROM public.bookings WHERE id = booking), '2029-12-02');
END
$$;

-- Workspace isolation (existing booking_access policy, unchanged by this migration).
DO $$
DECLARE
  ua uuid := 'a0000000-0000-4000-8000-000000000001';
  ub uuid := 'b0000000-0000-4000-8000-000000000001';
  wa uuid := 'a0000000-0000-4000-8000-0000000000aa';
  wb uuid := 'b0000000-0000-4000-8000-0000000000bb';
  aa uuid := 'a0000000-0000-4000-8000-00000000a471';
  ab uuid := 'b0000000-0000-4000-8000-00000000b471';
  booking_a uuid := bb_test.seed(wa, aa, 'in_progress', '2030-02-01');
  booking_b uuid := bb_test.seed(wb, ab, 'in_progress', '2030-02-01');
  total_a text := (SELECT count(*)::text FROM public.bookings WHERE workspace_id = wa);
BEGIN
  PERFORM bb_test.eq('rls: B cannot transition A', bb_test.run_as(ub, format('UPDATE public.bookings SET status = ''confirmed'' WHERE id = %L', booking_a)), 'OK:0');
  PERFORM bb_test.eq('rls: B cannot set hold expiry on A', bb_test.run_as(ub, format('UPDATE public.bookings SET status = ''hold'', hold_expires_on = ''2030-01-01'' WHERE id = %L', booking_a)), 'OK:0');
  PERFORM bb_test.eq('rls: B cannot delete A', bb_test.run_as(ub, format('DELETE FROM public.bookings WHERE id = %L', booking_a)), 'OK:0');
  PERFORM bb_test.eq('rls: A row unchanged', (SELECT status FROM public.bookings WHERE id = booking_a), 'in_progress');
  PERFORM bb_test.eq('rls: B cannot insert into A', bb_test.run_as(ub, format('INSERT INTO public.bookings (workspace_id, artist_id, date, start_time) VALUES (%L, %L, ''2030-01-01'', ''20:00'')', wa, aa)), '42501');
  PERFORM bb_test.eq('rls: B cannot move own booking into A', bb_test.run_as(ub, format('UPDATE public.bookings SET workspace_id = %L, artist_id = %L WHERE id = %L', wa, aa, booking_b)), '42501');
  PERFORM bb_test.eq('rls: B sees no row of A', bb_test.run_as(ub, format('DO $t$ BEGIN IF EXISTS (SELECT 1 FROM public.bookings WHERE workspace_id = %L) THEN RAISE EXCEPTION ''leak''; END IF; END $t$', wa)), 'OK:0');
  PERFORM bb_test.eq('rls: no session sees no row', bb_test.run_as(NULL, 'DO $t$ BEGIN IF EXISTS (SELECT 1 FROM public.bookings) THEN RAISE EXCEPTION ''leak''; END IF; END $t$'), 'OK:0');
  PERFORM bb_test.eq('rls: no session cannot transition', bb_test.run_as(NULL, format('UPDATE public.bookings SET status = ''confirmed'' WHERE id = %L', booking_a)), 'OK:0');
  PERFORM bb_test.eq('rls: B transitions its own booking', bb_test.run_as(ub, format('UPDATE public.bookings SET status = ''hold'' WHERE id = %L', booking_b)), 'OK:1');
  PERFORM bb_test.eq('rls: A transitions its own booking', bb_test.run_as(ua, format('UPDATE public.bookings SET status = ''option'' WHERE id = %L', booking_a)), 'OK:1');
  PERFORM bb_test.eq('rls: A row count stable', (SELECT count(*)::text FROM public.bookings WHERE workspace_id = wa), total_a);
END
$$;

-- The staging verification script reports through its final exception and changes no row.
DELETE FROM public.bookings;
-- An older past-dated in_progress booking and one in a workspace without active members
-- must not be picked over the future-dated test booking (Codex review, PR #29).
SELECT bb_test.seed(:wa, :aa, 'in_progress', CURRENT_DATE - 10) AS older \gset
UPDATE public.bookings SET created_at = now() - interval '30 days' WHERE id = :'older';
SELECT bb_test.seed(:wa, :aa, 'in_progress', CURRENT_DATE + 30) AS probe \gset
UPDATE public.bookings SET created_at = now() - interval '10 days' WHERE id = :'probe';
SELECT bb_test.seed(:wa, :aa, 'in_progress', CURRENT_DATE) AS newest \gset
\set ON_ERROR_STOP off
\o /dev/null
\ir ../../ops/supabase/booking-lifecycle/verify.sql
\o
\set ON_ERROR_STOP on
SELECT bb_test.eq('verify.sql: reports through SQLSTATE BBV00', :'LAST_ERROR_SQLSTATE', 'BBV00');
SELECT bb_test.eq('verify.sql: every check passes',
  split_part(:'LAST_ERROR_MESSAGE', E'\n', 1), 'BOOKING_LIFECYCLE_VERIFY ALL PASS: pass=9 fail=0 skip=0');
SELECT bb_test.eq('verify.sql: one line per check',
  (array_length(string_to_array(:'LAST_ERROR_MESSAGE', E'\n'), 1))::text, '10');
SELECT bb_test.eq('verify.sql: no row changed, nothing left behind',
  (SELECT count(*)::text || ':' || min(status) || ':' || coalesce(min(hold_expires_on)::text, '-') FROM public.bookings)
  || ':' || coalesce(to_regclass('pg_temp.bb_lifecycle_verify')::text, 'no-temp'),
  '3:in_progress:-:no-temp');
SELECT bb_test.eq('verify.sql: role restored', current_user::text, 'postgres');
DELETE FROM public.bookings;
\set ON_ERROR_STOP off
\o /dev/null
\ir ../../ops/supabase/booking-lifecycle/verify.sql
\o
\set ON_ERROR_STOP on
SELECT bb_test.eq('verify.sql: reports INCOMPLETE without data',
  split_part(:'LAST_ERROR_MESSAGE', E'\n', 1), 'BOOKING_LIFECYCLE_VERIFY INCOMPLETE: pass=0 fail=0 skip=1');

-- Rollback keeps a backup of hold/option rows, then restore puts them back.
DELETE FROM public.bookings;
SELECT bb_test.seed(:wa, :aa, 'hold', '2031-01-01', '2030-12-01') AS held \gset
SELECT bb_test.seed(:wa, :aa, 'option', '2031-01-02') AS optioned \gset
SELECT bb_test.seed(:wb, :ab, 'confirmed', '2031-01-03') AS kept \gset
\ir ../../ops/supabase/booking-lifecycle/rollback.sql
SELECT bb_test.eq('rollback: hold/option back to in_progress',
  (SELECT string_agg(status, ',' ORDER BY date) FROM public.bookings), 'in_progress,in_progress,confirmed');
SELECT bb_test.eq('rollback: column, trigger and function removed',
  ((SELECT count(*) FROM information_schema.columns WHERE table_name = 'bookings' AND column_name = 'hold_expires_on')
   + (SELECT count(*) FROM pg_trigger WHERE tgname = 'bookings_enforce_status')
   + (SELECT count(*) FROM pg_proc WHERE proname = 'backbeat_enforce_booking_status'))::text, '0');
SELECT bb_test.eq('rollback: backup holds previous values',
  (SELECT string_agg(status || ':' || coalesce(hold_expires_on::text, '-'), ',' ORDER BY status)
   FROM public.bookings_lifecycle_rollback_backup), 'hold:2030-12-01,option:-');
SELECT bb_test.eq('rollback: backup hidden from API roles',
  bb_test.run_as(:ua, 'SELECT 1 FROM public.bookings_lifecycle_rollback_backup'), '42501');
SELECT bb_test.eq('rollback: legacy CHECK restored',
  bb_test.run_as(:ua, format('UPDATE public.bookings SET status = ''hold'' WHERE id = %L', :'held')), '23514');
\ir ../../ops/supabase/booking-lifecycle/rollback.sql
SELECT bb_test.eq('rollback: second run keeps the first backup',
  (SELECT count(*)::text FROM public.bookings_lifecycle_rollback_backup), '2');
\ir ../../migrations/006_booking_lifecycle.sql
\ir ../../ops/supabase/booking-lifecycle/restore.sql
SELECT bb_test.eq('restore: statuses and expiry back',
  (SELECT string_agg(status || ':' || coalesce(hold_expires_on::text, '-'), ',' ORDER BY date) FROM public.bookings),
  'hold:2030-12-01,option:-,confirmed:-');
SELECT bb_test.eq('restore: backup table dropped',
  coalesce(to_regclass('public.bookings_lifecycle_rollback_backup')::text, 'ABSENT'), 'ABSENT');

-- Guard matrix: marker class x target. Probe = whether 006 (re)creates the trigger.
-- Scenarios other than the real development marker use an unconstrained stand-in table.

DROP TRIGGER IF EXISTS bookings_enforce_status ON public.bookings;
SET backbeat.booking_lifecycle_target = 'development';
\set ON_ERROR_STOP off
\o /dev/null
\ir ../../migrations/005_booking_workspace_key.sql
\ir ../../migrations/006_booking_lifecycle.sql
\o
\set ON_ERROR_STOP on
SELECT bb_test.eq('guard: dev marker + development target applies',
  (SELECT count(*)::text FROM pg_trigger WHERE tgname = 'bookings_enforce_status'), '1');

DROP TRIGGER IF EXISTS bookings_enforce_status ON public.bookings;
SET backbeat.booking_lifecycle_target = 'hosted:hupkygptbvnzrihrlcxv';
\set ON_ERROR_STOP off
\o /dev/null
\ir ../../migrations/005_booking_workspace_key.sql
\ir ../../migrations/006_booking_lifecycle.sql
\o
\set ON_ERROR_STOP on
SELECT bb_test.eq('guard: dev marker + staging target refused',
  (SELECT count(*)::text FROM pg_trigger WHERE tgname = 'bookings_enforce_status'), '0');

DROP TRIGGER IF EXISTS bookings_enforce_status ON public.bookings;
SET backbeat.booking_lifecycle_target = 'hosted:jttrznlbbjyufzyqmzzs';
\set ON_ERROR_STOP off
\o /dev/null
\ir ../../migrations/005_booking_workspace_key.sql
\ir ../../migrations/006_booking_lifecycle.sql
\o
\set ON_ERROR_STOP on
SELECT bb_test.eq('guard: dev marker + production ref refused',
  (SELECT count(*)::text FROM pg_trigger WHERE tgname = 'bookings_enforce_status'), '0');

DROP TRIGGER IF EXISTS bookings_enforce_status ON public.bookings;
ALTER TABLE public.runtime_environment RENAME TO runtime_environment_real;
CREATE TABLE public.runtime_environment (id text, environment text, synthetic_only boolean);
INSERT INTO public.runtime_environment VALUES ('backbeat-staging', 'staging', true);
SET backbeat.booking_lifecycle_target = 'hosted:hupkygptbvnzrihrlcxv';
\set ON_ERROR_STOP off
\o /dev/null
\ir ../../migrations/005_booking_workspace_key.sql
\ir ../../migrations/006_booking_lifecycle.sql
\o
\set ON_ERROR_STOP on
SELECT bb_test.eq('guard: staging marker + staging target applies',
  (SELECT count(*)::text FROM pg_trigger WHERE tgname = 'bookings_enforce_status'), '1');
DROP TABLE public.runtime_environment;
ALTER TABLE public.runtime_environment_real RENAME TO runtime_environment;

DROP TRIGGER IF EXISTS bookings_enforce_status ON public.bookings;
ALTER TABLE public.runtime_environment RENAME TO runtime_environment_real;
CREATE TABLE public.runtime_environment (id text, environment text, synthetic_only boolean);
INSERT INTO public.runtime_environment VALUES ('backbeat-staging', 'staging', true);
SET backbeat.booking_lifecycle_target = 'development';
\set ON_ERROR_STOP off
\o /dev/null
\ir ../../migrations/005_booking_workspace_key.sql
\ir ../../migrations/006_booking_lifecycle.sql
\o
\set ON_ERROR_STOP on
SELECT bb_test.eq('guard: staging marker + development target refused',
  (SELECT count(*)::text FROM pg_trigger WHERE tgname = 'bookings_enforce_status'), '0');
DROP TABLE public.runtime_environment;
ALTER TABLE public.runtime_environment_real RENAME TO runtime_environment;

DROP TRIGGER IF EXISTS bookings_enforce_status ON public.bookings;
ALTER TABLE public.runtime_environment RENAME TO runtime_environment_real;
SET backbeat.booking_lifecycle_target = 'hosted:hupkygptbvnzrihrlcxv';
\set ON_ERROR_STOP off
\o /dev/null
\ir ../../migrations/005_booking_workspace_key.sql
\ir ../../migrations/006_booking_lifecycle.sql
\o
\set ON_ERROR_STOP on
SELECT bb_test.eq('guard: absent marker table (production shape) + staging target refused',
  (SELECT count(*)::text FROM pg_trigger WHERE tgname = 'bookings_enforce_status'), '0');
ALTER TABLE public.runtime_environment_real RENAME TO runtime_environment;

DROP TRIGGER IF EXISTS bookings_enforce_status ON public.bookings;
ALTER TABLE public.runtime_environment RENAME TO runtime_environment_real;
SET backbeat.booking_lifecycle_target = 'development';
\set ON_ERROR_STOP off
\o /dev/null
\ir ../../migrations/005_booking_workspace_key.sql
\ir ../../migrations/006_booking_lifecycle.sql
\o
\set ON_ERROR_STOP on
SELECT bb_test.eq('guard: absent marker table (production shape) + development target refused',
  (SELECT count(*)::text FROM pg_trigger WHERE tgname = 'bookings_enforce_status'), '0');
ALTER TABLE public.runtime_environment_real RENAME TO runtime_environment;

DROP TRIGGER IF EXISTS bookings_enforce_status ON public.bookings;
ALTER TABLE public.runtime_environment RENAME TO runtime_environment_real;
CREATE TABLE public.runtime_environment (id text, environment text, synthetic_only boolean);
SET backbeat.booking_lifecycle_target = 'hosted:hupkygptbvnzrihrlcxv';
\set ON_ERROR_STOP off
\o /dev/null
\ir ../../migrations/005_booking_workspace_key.sql
\ir ../../migrations/006_booking_lifecycle.sql
\o
\set ON_ERROR_STOP on
SELECT bb_test.eq('guard: empty marker table refused',
  (SELECT count(*)::text FROM pg_trigger WHERE tgname = 'bookings_enforce_status'), '0');
DROP TABLE public.runtime_environment;
ALTER TABLE public.runtime_environment_real RENAME TO runtime_environment;

DROP TRIGGER IF EXISTS bookings_enforce_status ON public.bookings;
ALTER TABLE public.runtime_environment RENAME TO runtime_environment_real;
CREATE TABLE public.runtime_environment (id text, environment text, synthetic_only boolean);
INSERT INTO public.runtime_environment VALUES ('backbeat-staging', 'staging', true);
INSERT INTO public.runtime_environment VALUES ('backbeat-dev', 'development', true);
SET backbeat.booking_lifecycle_target = 'hosted:hupkygptbvnzrihrlcxv';
\set ON_ERROR_STOP off
\o /dev/null
\ir ../../migrations/005_booking_workspace_key.sql
\ir ../../migrations/006_booking_lifecycle.sql
\o
\set ON_ERROR_STOP on
SELECT bb_test.eq('guard: two marker rows refused',
  (SELECT count(*)::text FROM pg_trigger WHERE tgname = 'bookings_enforce_status'), '0');
DROP TABLE public.runtime_environment;
ALTER TABLE public.runtime_environment_real RENAME TO runtime_environment;

DROP TRIGGER IF EXISTS bookings_enforce_status ON public.bookings;
ALTER TABLE public.runtime_environment RENAME TO runtime_environment_real;
CREATE TABLE public.runtime_environment (id text, environment text, synthetic_only boolean);
INSERT INTO public.runtime_environment VALUES ('backbeat-staging', 'staging', true);
INSERT INTO public.runtime_environment VALUES ('backbeat-dev', 'development', true);
SET backbeat.booking_lifecycle_target = 'development';
\set ON_ERROR_STOP off
\o /dev/null
\ir ../../migrations/005_booking_workspace_key.sql
\ir ../../migrations/006_booking_lifecycle.sql
\o
\set ON_ERROR_STOP on
SELECT bb_test.eq('guard: two marker rows refused for development too',
  (SELECT count(*)::text FROM pg_trigger WHERE tgname = 'bookings_enforce_status'), '0');
DROP TABLE public.runtime_environment;
ALTER TABLE public.runtime_environment_real RENAME TO runtime_environment;

DROP TRIGGER IF EXISTS bookings_enforce_status ON public.bookings;
ALTER TABLE public.runtime_environment RENAME TO runtime_environment_real;
CREATE TABLE public.runtime_environment (id text, environment text, synthetic_only boolean);
INSERT INTO public.runtime_environment VALUES ('backbeat-staging', 'production', true);
SET backbeat.booking_lifecycle_target = 'hosted:hupkygptbvnzrihrlcxv';
\set ON_ERROR_STOP off
\o /dev/null
\ir ../../migrations/005_booking_workspace_key.sql
\ir ../../migrations/006_booking_lifecycle.sql
\o
\set ON_ERROR_STOP on
SELECT bb_test.eq('guard: staging id with another environment refused',
  (SELECT count(*)::text FROM pg_trigger WHERE tgname = 'bookings_enforce_status'), '0');
DROP TABLE public.runtime_environment;
ALTER TABLE public.runtime_environment_real RENAME TO runtime_environment;

DROP TRIGGER IF EXISTS bookings_enforce_status ON public.bookings;
ALTER TABLE public.runtime_environment RENAME TO runtime_environment_real;
CREATE TABLE public.runtime_environment (id text, environment text, synthetic_only boolean);
INSERT INTO public.runtime_environment VALUES ('backbeat-prod', 'staging', true);
SET backbeat.booking_lifecycle_target = 'hosted:hupkygptbvnzrihrlcxv';
\set ON_ERROR_STOP off
\o /dev/null
\ir ../../migrations/005_booking_workspace_key.sql
\ir ../../migrations/006_booking_lifecycle.sql
\o
\set ON_ERROR_STOP on
SELECT bb_test.eq('guard: another id with staging environment refused',
  (SELECT count(*)::text FROM pg_trigger WHERE tgname = 'bookings_enforce_status'), '0');
DROP TABLE public.runtime_environment;
ALTER TABLE public.runtime_environment_real RENAME TO runtime_environment;

DROP TRIGGER IF EXISTS bookings_enforce_status ON public.bookings;
ALTER TABLE public.runtime_environment RENAME TO runtime_environment_real;
CREATE TABLE public.runtime_environment (id text, environment text, synthetic_only boolean);
INSERT INTO public.runtime_environment VALUES ('backbeat-staging', 'staging', false);
SET backbeat.booking_lifecycle_target = 'hosted:hupkygptbvnzrihrlcxv';
\set ON_ERROR_STOP off
\o /dev/null
\ir ../../migrations/005_booking_workspace_key.sql
\ir ../../migrations/006_booking_lifecycle.sql
\o
\set ON_ERROR_STOP on
SELECT bb_test.eq('guard: synthetic_only false refused',
  (SELECT count(*)::text FROM pg_trigger WHERE tgname = 'bookings_enforce_status'), '0');
DROP TABLE public.runtime_environment;
ALTER TABLE public.runtime_environment_real RENAME TO runtime_environment;

DROP TRIGGER IF EXISTS bookings_enforce_status ON public.bookings;
ALTER TABLE public.runtime_environment RENAME TO runtime_environment_real;
CREATE TABLE public.runtime_environment (id text, environment text, synthetic_only boolean);
INSERT INTO public.runtime_environment VALUES ('backbeat-staging', 'staging', NULL);
SET backbeat.booking_lifecycle_target = 'hosted:hupkygptbvnzrihrlcxv';
\set ON_ERROR_STOP off
\o /dev/null
\ir ../../migrations/005_booking_workspace_key.sql
\ir ../../migrations/006_booking_lifecycle.sql
\o
\set ON_ERROR_STOP on
SELECT bb_test.eq('guard: synthetic_only null refused',
  (SELECT count(*)::text FROM pg_trigger WHERE tgname = 'bookings_enforce_status'), '0');
DROP TABLE public.runtime_environment;
ALTER TABLE public.runtime_environment_real RENAME TO runtime_environment;

-- Rollback and restore carry the same guard: refused on a production-shaped database.
SET backbeat.booking_lifecycle_target = 'development';
\ir ../../migrations/006_booking_lifecycle.sql
ALTER TABLE public.runtime_environment RENAME TO runtime_environment_real;
SET backbeat.booking_lifecycle_target = 'hosted:hupkygptbvnzrihrlcxv';
\set ON_ERROR_STOP off
\o /dev/null
\ir ../../ops/supabase/booking-lifecycle/rollback.sql
\ir ../../ops/supabase/booking-lifecycle/restore.sql
\o
\set ON_ERROR_STOP on
ALTER TABLE public.runtime_environment_real RENAME TO runtime_environment;
SELECT bb_test.eq('guard: rollback refused without a marker, schema intact',
  (SELECT count(*)::text FROM pg_trigger WHERE tgname = 'bookings_enforce_status')
  || ':' || coalesce(to_regclass('public.bookings_lifecycle_rollback_backup')::text, 'no-backup'), '1:no-backup');
\echo BOOKING_LIFECYCLE_SQL_TESTS_PASSED
