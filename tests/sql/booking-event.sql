-- SQL contract test for migration 008 (booking -> event, booking promoter), its ops files
-- and its rollback. Run through tests/sql/run-booking-event.sh on a throwaway local cluster;
-- never on a hosted database.
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

-- Fixtures: two workspaces, one active member, one artist and one promoter each.
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
  ('a0000000-0000-4000-8000-00000000a472', 'a0000000-0000-4000-8000-0000000000aa', 'Artist A2'),
  ('b0000000-0000-4000-8000-00000000b471', 'b0000000-0000-4000-8000-0000000000bb', 'Artist B');
INSERT INTO public.promoters (id, workspace_id, name) VALUES
  ('a0000000-0000-4000-8000-0000000000f1', 'a0000000-0000-4000-8000-0000000000aa', 'Promoter A'),
  ('b0000000-0000-4000-8000-0000000000f1', 'b0000000-0000-4000-8000-0000000000bb', 'Promoter B');
INSERT INTO public.bookings (id, workspace_id, artist_id, date, start_time, venue_name, fee_amount_minor, fee_currency) VALUES
  ('a0000000-0000-4000-8000-0000000b0001', 'a0000000-0000-4000-8000-0000000000aa', 'a0000000-0000-4000-8000-00000000a471', '2030-05-01', '21:00', 'Club A', 100000, 'EUR'),
  ('a0000000-0000-4000-8000-0000000b0002', 'a0000000-0000-4000-8000-0000000000aa', 'a0000000-0000-4000-8000-00000000a471', '2030-05-02', '21:00', NULL, NULL, NULL),
  ('a0000000-0000-4000-8000-0000000b0003', 'a0000000-0000-4000-8000-0000000000aa', 'a0000000-0000-4000-8000-00000000a472', '2030-05-03', '22:30', 'Hall A', 500000, 'JPY'),
  ('b0000000-0000-4000-8000-0000000b0001', 'b0000000-0000-4000-8000-0000000000bb', 'b0000000-0000-4000-8000-00000000b471', '2030-05-01', '21:00', 'Club B', 100000, 'EUR');
-- Events that exist BEFORE 008: one per supported status, plus one in workspace B.
INSERT INTO public.events (workspace_id, title, date, status, artist_id, promoter_id)
  SELECT 'a0000000-0000-4000-8000-0000000000aa', 'legacy-' || s, '2030-06-01', s,
         'a0000000-0000-4000-8000-00000000a471', 'a0000000-0000-4000-8000-0000000000f1'
  FROM unnest(ARRAY['in_progress', 'confirmed', 'cancelled']) AS s;
INSERT INTO public.events (workspace_id, title, date, status) VALUES
  ('b0000000-0000-4000-8000-0000000000bb', 'legacy-b', '2030-06-01', 'confirmed');
CREATE TABLE bb_test.events_before AS SELECT id, to_jsonb(e) AS row FROM public.events AS e;
CREATE TABLE bb_test.bookings_before AS SELECT id, to_jsonb(b) AS row FROM public.bookings AS b;
\set ua '''a0000000-0000-4000-8000-000000000001'''
\set ub '''b0000000-0000-4000-8000-000000000001'''

-- The read-only preflight must execute before 008 and report readiness.
\ir ../../ops/supabase/booking-event/preflight.sql
\set preflight `sed -e 's/;[[:space:]]*$//' ../../ops/supabase/booking-event/preflight.sql`
SELECT bb_test.eq('preflight: ready, nothing applied',
  (SELECT string_agg(detail, ' | ' ORDER BY item) FROM (:preflight) AS p
   WHERE item IN ('ready for 008', '008 objects present', 'runtime_environment marker class')),
  '0/13 | READY_FOR_008 | development');
SELECT bb_test.eq('preflight: no status violation listed',
  (SELECT count(*)::text FROM (:preflight) AS p WHERE section = 'status_violation'), '0');

-- Decision 5 guard: an event row outside the three statuses blocks 008; the preflight lists it.
INSERT INTO public.events (id, workspace_id, title, date, status) VALUES
  ('a0000000-0000-4000-8000-0000000e00ff', 'a0000000-0000-4000-8000-0000000000aa', 'legacy-completed', '2030-06-02', 'completed');
SELECT bb_test.eq('preflight: violating event listed by id and status only',
  (SELECT string_agg(item || ' => ' || detail, '; ') FROM (:preflight) AS p WHERE section = 'status_violation'),
  'event a0000000-0000-4000-8000-0000000e00ff => workspace a0000000-0000-4000-8000-0000000000aa | status completed');
SELECT bb_test.eq('preflight: blocked by the violating row',
  (SELECT detail FROM (:preflight) AS p WHERE item = 'ready for 008'),
  'BLOCKED: 1 event row(s) violate the status CHECK (see status_violation rows)');
SET backbeat.booking_event_target = 'development';
\set ON_ERROR_STOP off
\o /dev/null
\ir ../../migrations/008_booking_event.sql
\o
\set ON_ERROR_STOP on
SELECT bb_test.eq('check guard: nothing applied, violating row untouched',
  (SELECT count(*)::text FROM information_schema.columns WHERE table_schema = 'public'
     AND ((table_name = 'events' AND column_name = 'booking_id') OR (table_name = 'bookings' AND column_name = 'promoter_id')))
  || ':' || (SELECT count(*)::text FROM pg_constraint WHERE conname IN ('events_status_check', 'events_workspace_id_id_key'))
  || ':' || (SELECT status FROM public.events WHERE id = 'a0000000-0000-4000-8000-0000000e00ff'), '0:0:completed');
DELETE FROM public.events WHERE id = 'a0000000-0000-4000-8000-0000000e00ff';
RESET backbeat.booking_event_target;

-- Target guard: no explicit target, the production ref, the staging target on a development
-- marker and the lifecycle setting alone are all refused; so is the rollback.
\set ON_ERROR_STOP off
\o /dev/null
\ir ../../migrations/008_booking_event.sql
SET backbeat.booking_event_target = 'hosted:jttrznlbbjyufzyqmzzs';
\ir ../../migrations/008_booking_event.sql
SET backbeat.booking_event_target = 'hosted:hupkygptbvnzrihrlcxv';
\ir ../../migrations/008_booking_event.sql
\ir ../../ops/supabase/booking-event/rollback.sql
\o
\set ON_ERROR_STOP on
SELECT bb_test.eq('guard: refused targets add nothing',
  (SELECT count(*)::text FROM information_schema.columns WHERE table_schema = 'public'
     AND ((table_name = 'events' AND column_name IN ('booking_id', 'start_time', 'fee_amount_minor', 'fee_currency'))
       OR (table_name = 'bookings' AND column_name = 'promoter_id')))
  || ':' || (SELECT count(*)::text FROM pg_constraint WHERE conname IN ('events_status_check', 'events_workspace_id_id_key', 'events_booking_id_key'))
  || ':' || coalesce(to_regclass('public.booking_event_rollback_backup')::text, 'no-backup'), '0:0:no-backup');

SET backbeat.booking_event_target = 'development';
\ir ../../migrations/008_booking_event.sql
-- Idempotency: a second run must succeed and change nothing.
\ir ../../migrations/008_booking_event.sql

SELECT bb_test.eq('existing rows: events untouched, no backfill',
  (SELECT count(*)::text FROM public.events AS e JOIN bb_test.events_before AS o USING (id)
   WHERE to_jsonb(e) - ARRAY['booking_id', 'start_time', 'fee_amount_minor', 'fee_currency'] = o.row
     AND e.booking_id IS NULL AND e.start_time IS NULL AND e.fee_amount_minor IS NULL AND e.fee_currency IS NULL), '4');
SELECT bb_test.eq('existing rows: bookings untouched, no backfill',
  (SELECT count(*)::text FROM public.bookings AS b JOIN bb_test.bookings_before AS o USING (id)
   WHERE to_jsonb(b) - ARRAY['promoter_id'] = o.row AND b.promoter_id IS NULL), '4');
SELECT bb_test.eq('schema: policy set unchanged',
  (SELECT string_agg(policyname || ':' || cmd, ',' ORDER BY policyname) FROM pg_policies
   WHERE schemaname = 'public' AND tablename IN ('bookings', 'events', 'promoters')),
  'booking_access:ALL,event_access:ALL,promoter_access:ALL');
SELECT bb_test.eq('schema: grants unchanged (authenticated only)',
  (SELECT string_agg(DISTINCT grantee, ',') FROM information_schema.role_table_grants
   WHERE table_schema = 'public' AND table_name IN ('bookings', 'events', 'promoters')
     AND grantee IN ('anon', 'authenticated', 'PUBLIC')), 'authenticated');
SELECT bb_test.eq('schema: exactly one status CHECK on events',
  (SELECT string_agg(conname, ',') FROM pg_constraint WHERE conrelid = 'public.events'::regclass
   AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%status%'), 'events_status_check');
SELECT bb_test.eq('schema: 008 objects all present',
  (SELECT detail FROM (:preflight) AS p WHERE item = '008 objects present'), '13/13');

-- The postflight must execute and pass on the migrated schema.
\ir ../../ops/supabase/booking-event/postflight.sql
\set postflight `sed -e 's/;[[:space:]]*$//' ../../ops/supabase/booking-event/postflight.sql`
SELECT bb_test.eq('postflight: every check passes',
  (SELECT string_agg(result || ' ' || detail, '') FROM (:postflight) AS p WHERE ord = 99), 'ALL PASS 14/14');
SELECT bb_test.eq('postflight: no failing row',
  (SELECT coalesce(string_agg(item, '; '), 'none') FROM (:postflight) AS p WHERE result <> 'PASS' AND ord <> 99), 'none');

-- verify.sql: every check passes and nothing is left behind.
CREATE TABLE bb_test.counts_before AS SELECT
  (SELECT count(*) FROM public.events) AS events, (SELECT count(*) FROM public.bookings) AS bookings,
  (SELECT count(*) FROM public.promoters) AS promoters, (SELECT count(*) FROM public.workspaces) AS workspaces,
  (SELECT count(*) FROM public.artists) AS artists;
\ir ../../ops/supabase/booking-event/verify.sql
SELECT bb_test.eq('verify.sql: 16 PASS lines, no FAIL or SKIP',
  (SELECT count(*) FILTER (WHERE line LIKE 'PASS|%')::text || ':' || count(*) FILTER (WHERE line NOT LIKE 'PASS|%')::text
   FROM unnest(string_to_array(current_setting('backbeat.event_verify_report'), E'\n')) AS line), '16:0');
\set verify `sed -e '1,/^\$verify\$;$/d' -e 's/;[[:space:]]*$//' ../../ops/supabase/booking-event/verify.sql`
SELECT bb_test.eq('verify.sql: summary row',
  (SELECT result || ' ' || detail FROM (:verify) AS v WHERE ord = 0), 'ALL PASS pass=16 fail=0 skip=0');
SELECT bb_test.eq('verify.sql: leaves no row behind',
  (SELECT (c.events = (SELECT count(*) FROM public.events) AND c.bookings = (SELECT count(*) FROM public.bookings)
     AND c.promoters = (SELECT count(*) FROM public.promoters) AND c.workspaces = (SELECT count(*) FROM public.workspaces)
     AND c.artists = (SELECT count(*) FROM public.artists))::text FROM bb_test.counts_before AS c), 'true');
SELECT bb_test.eq('verify.sql: session role restored', current_user::text, 'postgres');

DO $$
DECLARE
  ua uuid := 'a0000000-0000-4000-8000-000000000001';
  ub uuid := 'b0000000-0000-4000-8000-000000000001';
  wa uuid := 'a0000000-0000-4000-8000-0000000000aa';
  wb uuid := 'b0000000-0000-4000-8000-0000000000bb';
  a1 uuid := 'a0000000-0000-4000-8000-00000000a471';
  pa uuid := 'a0000000-0000-4000-8000-0000000000f1';
  pb uuid := 'b0000000-0000-4000-8000-0000000000f1';
  b1 uuid := 'a0000000-0000-4000-8000-0000000b0001';
  b2 uuid := 'a0000000-0000-4000-8000-0000000b0002';
  b3 uuid := 'a0000000-0000-4000-8000-0000000b0003';
  bb uuid := 'b0000000-0000-4000-8000-0000000b0001';
  e1 uuid := 'a0000000-0000-4000-8000-0000000e0001';
  ins text := 'INSERT INTO public.events (workspace_id, title, date, status%s) VALUES (%L, %L, ''2030-05-01'', %L%s)';
BEGIN
  -- One event per booking (decision 1) and the conversion snapshot (decision 3).
  PERFORM bb_test.eq('convert: event linked to the booking with snapshot',
    bb_test.run_as(ua, format('INSERT INTO public.events (id, workspace_id, title, date, location, status, artist_id, promoter_id, booking_id, start_time, fee_amount_minor, fee_currency) '
      || 'VALUES (%L, %L, ''Artist A @ Club A'', ''2030-05-01'', ''Club A'', ''confirmed'', %L, %L, %L, ''21:00'', 100000, ''EUR'')', e1, wa, a1, pa, b1)), 'OK:1');
  PERFORM bb_test.eq('convert: retry for the same booking is a unique violation',
    bb_test.run_as(ua, format(ins, ', booking_id', wa, 'retry', 'confirmed', format(', %L', b1))), '23505');
  PERFORM bb_test.eq('convert: still exactly one event for the booking',
    (SELECT count(*)::text FROM public.events WHERE booking_id = b1), '1');
  PERFORM bb_test.eq('convert: another booking gets its own event',
    bb_test.run_as(ua, format(ins, ', booking_id', wa, 'second booking', 'confirmed', format(', %L', b2))), 'OK:1');
  PERFORM bb_test.eq('convert: an existing event cannot be re-pointed at a converted booking',
    bb_test.run_as(ua, format('UPDATE public.events SET booking_id = %L WHERE booking_id = %L', b1, b2)), '23505');
  PERFORM bb_test.eq('events without a booking stay unlimited (first)', bb_test.run_as(ua, format(ins, '', wa, 'free 1', 'in_progress', '')), 'OK:1');
  PERFORM bb_test.eq('events without a booking stay unlimited (second)', bb_test.run_as(ua, format(ins, '', wa, 'free 2', 'in_progress', '')), 'OK:1');
  PERFORM bb_test.eq('convert: unknown booking rejected',
    bb_test.run_as(ua, format(ins, ', booking_id', wa, 'orphan', 'confirmed', format(', %L', gen_random_uuid()))), '23503');

  -- Cross-workspace isolation: composite FK plus the unchanged active-member policy.
  PERFORM bb_test.eq('isolation: A event cannot link a booking of B',
    bb_test.run_as(ua, format(ins, ', booking_id', wa, 'cross', 'confirmed', format(', %L', bb))), '23503');
  PERFORM bb_test.eq('isolation: B event cannot link a booking of A',
    bb_test.run_as(ub, format(ins, ', booking_id', wb, 'cross', 'confirmed', format(', %L', b3))), '23503');
  PERFORM bb_test.eq('isolation: B cannot insert an event into A',
    bb_test.run_as(ub, format(ins, ', booking_id', wa, 'intruder', 'confirmed', format(', %L', b3))), '42501');
  PERFORM bb_test.eq('isolation: B cannot unlink or edit the event of A',
    bb_test.run_as(ub, format('UPDATE public.events SET booking_id = NULL, fee_amount_minor = 1, fee_currency = ''USD'' WHERE id = %L', e1)), 'OK:0');
  PERFORM bb_test.eq('isolation: B cannot delete the event of A',
    bb_test.run_as(ub, format('DELETE FROM public.events WHERE id = %L', e1)), 'OK:0');
  PERFORM bb_test.eq('isolation: B sees no event of A',
    bb_test.run_as(ub, format('DO $t$ BEGIN IF EXISTS (SELECT 1 FROM public.events WHERE workspace_id = %L) THEN RAISE EXCEPTION ''leak''; END IF; END $t$', wa)), 'OK:0');
  PERFORM bb_test.eq('isolation: no session sees no event',
    bb_test.run_as(NULL, 'DO $t$ BEGIN IF EXISTS (SELECT 1 FROM public.events) THEN RAISE EXCEPTION ''leak''; END IF; END $t$'), 'OK:0');
  PERFORM bb_test.eq('isolation: B cannot move its own event into A',
    bb_test.run_as(ub, format('UPDATE public.events SET workspace_id = %L WHERE workspace_id = %L', wa, wb)), '42501');
  PERFORM bb_test.eq('isolation: A event unchanged',
    (SELECT booking_id::text || ':' || fee_amount_minor || ':' || fee_currency FROM public.events WHERE id = e1), b1::text || ':100000:EUR');

  -- Decision 5: status CHECK, for inserts and updates.
  PERFORM bb_test.eq('status: completed rejected on insert', bb_test.run_as(ua, format(ins, '', wa, 'bad status', 'completed', '')), '23514');
  PERFORM bb_test.eq('status: hold rejected on insert', bb_test.run_as(ua, format(ins, '', wa, 'bad status', 'hold', '')), '23514');
  PERFORM bb_test.eq('status: unknown value rejected on update',
    bb_test.run_as(ua, format('UPDATE public.events SET status = ''done'' WHERE id = %L', e1)), '23514');
  PERFORM bb_test.eq('status: cancelled accepted on update',
    bb_test.run_as(ua, format('UPDATE public.events SET status = ''cancelled'' WHERE id = %L', e1)), 'OK:1');

  -- Decision 3: fee rules equal to the booking fee (pair, range, currency list).
  PERFORM bb_test.eq('fee: amount without currency rejected', bb_test.run_as(ua, format(ins, ', fee_amount_minor', wa, 'fee', 'confirmed', ', 100')), '23514');
  PERFORM bb_test.eq('fee: currency without amount rejected', bb_test.run_as(ua, format(ins, ', fee_currency', wa, 'fee', 'confirmed', ', ''EUR''')), '23514');
  PERFORM bb_test.eq('fee: negative amount rejected', bb_test.run_as(ua, format(ins, ', fee_amount_minor, fee_currency', wa, 'fee', 'confirmed', ', -1, ''EUR''')), '23514');
  PERFORM bb_test.eq('fee: amount above the maximum rejected', bb_test.run_as(ua, format(ins, ', fee_amount_minor, fee_currency', wa, 'fee', 'confirmed', ', 1000000000000, ''EUR''')), '23514');
  PERFORM bb_test.eq('fee: unsupported currency rejected', bb_test.run_as(ua, format(ins, ', fee_amount_minor, fee_currency', wa, 'fee', 'confirmed', ', 100, ''CHF''')), '23514');
  PERFORM bb_test.eq('fee: zero JPY accepted with a start time', bb_test.run_as(ua, format(ins, ', fee_amount_minor, fee_currency, start_time', wa, 'fee ok', 'confirmed', ', 0, ''JPY'', ''23:59''')), 'OK:1');
  PERFORM bb_test.eq('fee: cleared as a pair on update',
    bb_test.run_as(ua, format('UPDATE public.events SET fee_amount_minor = NULL, fee_currency = NULL, start_time = NULL WHERE id = %L', e1)), 'OK:1');

  -- Decision 2: optional promoter on bookings, same workspace only, nulled on promoter delete.
  PERFORM bb_test.eq('promoter: same-workspace promoter accepted',
    bb_test.run_as(ua, format('UPDATE public.bookings SET promoter_id = %L WHERE id IN (%L, %L)', pa, b1, b3)), 'OK:2');
  PERFORM bb_test.eq('promoter: promoter of another workspace rejected',
    bb_test.run_as(ua, format('UPDATE public.bookings SET promoter_id = %L WHERE id = %L', pb, b2)), '23503');
  PERFORM bb_test.eq('promoter: unknown promoter rejected',
    bb_test.run_as(ua, format('UPDATE public.bookings SET promoter_id = %L WHERE id = %L', gen_random_uuid(), b2)), '23503');
  PERFORM bb_test.eq('promoter: B cannot set the promoter of an A booking',
    bb_test.run_as(ub, format('UPDATE public.bookings SET promoter_id = NULL WHERE id = %L', b1)), 'OK:0');
  PERFORM bb_test.eq('promoter: insert with a promoter of another workspace rejected',
    bb_test.run_as(ua, format('INSERT INTO public.bookings (workspace_id, artist_id, date, start_time, promoter_id) VALUES (%L, %L, ''2030-07-01'', ''20:00'', %L)', wa, a1, pb)), '23503');
  PERFORM bb_test.eq('promoter: insert with a same-workspace promoter accepted',
    bb_test.run_as(ua, format('INSERT INTO public.bookings (workspace_id, artist_id, date, start_time, promoter_id) VALUES (%L, %L, ''2030-07-01'', ''20:00'', %L)', wa, a1, pa)), 'OK:1');
  PERFORM bb_test.eq('promoter: delete is allowed while bookings and events reference it',
    bb_test.run_as(ua, format('DELETE FROM public.promoters WHERE id = %L', pa)), 'OK:1');
  PERFORM bb_test.eq('promoter: bookings kept, only promoter_id cleared',
    (SELECT count(*)::text || ':' || count(promoter_id)::text || ':' || count(DISTINCT workspace_id)::text
     FROM public.bookings WHERE workspace_id = wa), '4:0:1');
  PERFORM bb_test.eq('promoter: events kept, only promoter_id cleared',
    (SELECT count(promoter_id)::text || ':' || (SELECT booking_id::text FROM public.events WHERE id = e1)
     FROM public.events WHERE workspace_id = wa), '0:' || b1::text);

  -- Decision 1: the event survives the deletion of its booking; only booking_id is nulled.
  PERFORM bb_test.eq('booking delete: allowed while an event references it',
    bb_test.run_as(ua, format('DELETE FROM public.bookings WHERE id = %L', b1)), 'OK:1');
  PERFORM bb_test.eq('booking delete: event kept with its workspace and data',
    (SELECT coalesce(booking_id::text, 'NULL') || ':' || workspace_id::text || ':' || title || ':' || artist_id::text
     FROM public.events WHERE id = e1), 'NULL:' || wa::text || ':Artist A @ Club A:' || a1::text);
  -- Deleting the artist cascades to its bookings (001); their events survive unlinked.
  PERFORM bb_test.eq('artist delete: cascades to bookings', bb_test.run_as(ua, format('DELETE FROM public.artists WHERE id = %L', a1)), 'OK:1');
  PERFORM bb_test.eq('artist delete: events kept without booking and artist',
    (SELECT count(*)::text || ':' || count(booking_id)::text || ':' || count(artist_id)::text
     FROM public.events WHERE title IN ('Artist A @ Club A', 'second booking')), '2:0:0');
END
$$;

-- Deleting a whole workspace still cascades through linked events and bookings.
INSERT INTO public.events (workspace_id, title, date, status, booking_id) VALUES
  ('b0000000-0000-4000-8000-0000000000bb', 'B linked', '2030-05-01', 'confirmed', 'b0000000-0000-4000-8000-0000000b0001');
UPDATE public.bookings SET promoter_id = 'b0000000-0000-4000-8000-0000000000f1' WHERE id = 'b0000000-0000-4000-8000-0000000b0001';
DELETE FROM public.workspaces WHERE id = 'b0000000-0000-4000-8000-0000000000bb';
SELECT bb_test.eq('workspace delete: cascades through events, bookings and promoters',
  (SELECT count(*)::text FROM public.events WHERE workspace_id = 'b0000000-0000-4000-8000-0000000000bb')
  || ':' || (SELECT count(*)::text FROM public.bookings WHERE workspace_id = 'b0000000-0000-4000-8000-0000000000bb')
  || ':' || (SELECT count(*)::text FROM public.promoters WHERE workspace_id = 'b0000000-0000-4000-8000-0000000000bb'), '0:0:0');

-- Rollback keeps a backup, never deletes events or bookings, and 008 can be applied again.
INSERT INTO public.promoters (id, workspace_id, name) VALUES
  ('a0000000-0000-4000-8000-0000000000f2', 'a0000000-0000-4000-8000-0000000000aa', 'Promoter A2');
UPDATE public.bookings SET promoter_id = 'a0000000-0000-4000-8000-0000000000f2' WHERE id = 'a0000000-0000-4000-8000-0000000b0003';
INSERT INTO public.events (id, workspace_id, title, date, status, booking_id, start_time, fee_amount_minor, fee_currency) VALUES
  ('a0000000-0000-4000-8000-0000000e0003', 'a0000000-0000-4000-8000-0000000000aa', 'Artist A2 @ Hall A', '2030-05-03', 'confirmed',
   'a0000000-0000-4000-8000-0000000b0003', '22:30', 500000, 'JPY');
SELECT count(*) AS events_before_rollback FROM public.events \gset
SELECT count(*) AS bookings_before_rollback FROM public.bookings \gset
\ir ../../ops/supabase/booking-event/rollback.sql
SELECT bb_test.eq('rollback: columns, link constraints and status CHECK removed',
  ((SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public'
     AND ((table_name = 'events' AND column_name IN ('booking_id', 'start_time', 'fee_amount_minor', 'fee_currency'))
       OR (table_name = 'bookings' AND column_name = 'promoter_id')))
   + (SELECT count(*) FROM pg_constraint WHERE conname IN ('events_status_check', 'events_booking_id_key',
        'events_booking_id_fkey', 'bookings_promoter_id_fkey', 'events_fee_pair_check'))
   + (SELECT count(*) FROM pg_indexes WHERE indexname = 'bookings_workspace_promoter_idx'))::text, '0');
SELECT bb_test.eq('rollback: additive events key kept',
  (SELECT count(*)::text FROM pg_constraint WHERE conname = 'events_workspace_id_id_key'), '1');
SELECT bb_test.eq('rollback: no event or booking deleted',
  (SELECT count(*)::text FROM public.events) || ':' || (SELECT count(*)::text FROM public.bookings),
  :'events_before_rollback' || ':' || :'bookings_before_rollback');
SELECT bb_test.eq('rollback: backup holds the removed values',
  (SELECT string_agg(source || ':' || coalesce(booking_id::text, '-') || ':' || coalesce(start_time::text, '-') || ':'
     || coalesce(fee_amount_minor::text, '-') || ':' || coalesce(fee_currency, '-') || ':' || coalesce(promoter_id::text, '-'), ' | ' ORDER BY source, id)
   FROM public.booking_event_rollback_backup WHERE id IN ('a0000000-0000-4000-8000-0000000e0003', 'a0000000-0000-4000-8000-0000000b0003')),
  'booking:-:-:-:-:a0000000-0000-4000-8000-0000000000f2 | event:a0000000-0000-4000-8000-0000000b0003:22:30:00:500000:JPY:-');
SELECT bb_test.eq('rollback: backup hidden from API roles',
  bb_test.run_as(:ua, 'SELECT 1 FROM public.booking_event_rollback_backup'), '42501');
SELECT count(*) AS backup_rows FROM public.booking_event_rollback_backup \gset
\ir ../../ops/supabase/booking-event/rollback.sql
SELECT bb_test.eq('rollback: second run keeps the first backup',
  (SELECT count(*)::text FROM public.booking_event_rollback_backup), :'backup_rows');
\ir ../../migrations/008_booking_event.sql
-- Manual restore documented in docs/booking-event.md (rows whose booking or promoter still exists).
UPDATE public.events AS e
  SET booking_id = k.booking_id, start_time = k.start_time,
      fee_amount_minor = k.fee_amount_minor, fee_currency = k.fee_currency
  FROM public.booking_event_rollback_backup AS k
  WHERE k.source = 'event' AND e.id = k.id AND e.workspace_id = k.workspace_id
    AND (k.booking_id IS NULL OR EXISTS (SELECT 1 FROM public.bookings AS b
      WHERE b.id = k.booking_id AND b.workspace_id = k.workspace_id));
UPDATE public.bookings AS b SET promoter_id = k.promoter_id
  FROM public.booking_event_rollback_backup AS k
  WHERE k.source = 'booking' AND b.id = k.id AND b.workspace_id = k.workspace_id
    AND EXISTS (SELECT 1 FROM public.promoters AS p
      WHERE p.id = k.promoter_id AND p.workspace_id = k.workspace_id);
SELECT bb_test.eq('restore: link, snapshot and promoter back',
  (SELECT booking_id::text || ':' || start_time::text || ':' || fee_amount_minor || ':' || fee_currency
   FROM public.events WHERE id = 'a0000000-0000-4000-8000-0000000e0003')
  || ' | ' || (SELECT promoter_id::text FROM public.bookings WHERE id = 'a0000000-0000-4000-8000-0000000b0003'),
  'a0000000-0000-4000-8000-0000000b0003:22:30:00:500000:JPY | a0000000-0000-4000-8000-0000000000f2');
DROP TABLE public.booking_event_rollback_backup;

-- Guard matrix: marker class x target. Probe = whether 008 (re)creates events_booking_id_key.
-- Scenarios other than the real development marker use an unconstrained stand-in table.
ALTER TABLE public.events DROP CONSTRAINT events_booking_id_key;
SET backbeat.booking_event_target = 'hosted:hupkygptbvnzrihrlcxv';
\set ON_ERROR_STOP off
\o /dev/null
\ir ../../migrations/008_booking_event.sql
\o
\set ON_ERROR_STOP on
SELECT bb_test.eq('guard: dev marker + staging target refused',
  (SELECT count(*)::text FROM pg_constraint WHERE conname = 'events_booking_id_key'), '0');

ALTER TABLE public.runtime_environment RENAME TO runtime_environment_real;
CREATE TABLE public.runtime_environment (id text, environment text, synthetic_only boolean);
INSERT INTO public.runtime_environment VALUES ('backbeat-staging', 'staging', true);
SET backbeat.booking_event_target = 'development';
\set ON_ERROR_STOP off
\o /dev/null
\ir ../../migrations/008_booking_event.sql
\o
\set ON_ERROR_STOP on
SELECT bb_test.eq('guard: staging marker + development target refused',
  (SELECT count(*)::text FROM pg_constraint WHERE conname = 'events_booking_id_key'), '0');
SET backbeat.booking_event_target = 'hosted:jttrznlbbjyufzyqmzzs';
\set ON_ERROR_STOP off
\o /dev/null
\ir ../../migrations/008_booking_event.sql
\o
\set ON_ERROR_STOP on
SELECT bb_test.eq('guard: staging marker + production ref refused',
  (SELECT count(*)::text FROM pg_constraint WHERE conname = 'events_booking_id_key'), '0');
INSERT INTO public.runtime_environment VALUES ('backbeat-dev', 'development', true);
SET backbeat.booking_event_target = 'hosted:hupkygptbvnzrihrlcxv';
\set ON_ERROR_STOP off
\o /dev/null
\ir ../../migrations/008_booking_event.sql
\o
\set ON_ERROR_STOP on
SELECT bb_test.eq('guard: two marker rows refused',
  (SELECT count(*)::text FROM pg_constraint WHERE conname = 'events_booking_id_key'), '0');
DELETE FROM public.runtime_environment WHERE id = 'backbeat-dev';
UPDATE public.runtime_environment SET synthetic_only = false;
\set ON_ERROR_STOP off
\o /dev/null
\ir ../../migrations/008_booking_event.sql
\o
\set ON_ERROR_STOP on
SELECT bb_test.eq('guard: synthetic_only false refused',
  (SELECT count(*)::text FROM pg_constraint WHERE conname = 'events_booking_id_key'), '0');
UPDATE public.runtime_environment SET synthetic_only = true;
\ir ../../migrations/008_booking_event.sql
SELECT bb_test.eq('guard: staging marker + staging target applies',
  (SELECT count(*)::text FROM pg_constraint WHERE conname = 'events_booking_id_key'), '1');
DROP TABLE public.runtime_environment;

ALTER TABLE public.events DROP CONSTRAINT events_booking_id_key;
\set ON_ERROR_STOP off
\o /dev/null
\ir ../../migrations/008_booking_event.sql
\ir ../../ops/supabase/booking-event/rollback.sql
\o
\set ON_ERROR_STOP on
SELECT bb_test.eq('guard: absent marker table (production shape) refuses 008 and its rollback',
  (SELECT count(*)::text FROM pg_constraint WHERE conname = 'events_booking_id_key')
  || ':' || (SELECT count(*)::text FROM information_schema.columns WHERE table_name = 'events' AND column_name = 'booking_id')
  || ':' || coalesce(to_regclass('public.booking_event_rollback_backup')::text, 'no-backup'), '0:1:no-backup');
ALTER TABLE public.runtime_environment_real RENAME TO runtime_environment;
\echo BOOKING_EVENT_SQL_TESTS_PASSED
