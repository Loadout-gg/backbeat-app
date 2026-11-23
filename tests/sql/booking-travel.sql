-- SQL contract test for migration 009 (booking travel legs, stays, artist travel documents)
-- and its preflight, postflight, verify, rollback and restore scripts.
-- Run through tests/sql/run-local.sh booking-travel on a throwaway local cluster; never hosted.
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

-- Fixtures: two workspaces, one active member, one artist and one booking each.
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
INSERT INTO public.bookings (id, workspace_id, artist_id, date, start_time) VALUES
  ('a0000000-0000-4000-8000-00000000b00a', 'a0000000-0000-4000-8000-0000000000aa', 'a0000000-0000-4000-8000-00000000a471', '2030-05-01', '21:00'),
  ('b0000000-0000-4000-8000-00000000b00b', 'b0000000-0000-4000-8000-0000000000bb', 'b0000000-0000-4000-8000-00000000b471', '2030-05-01', '21:00');
\set ua '''a0000000-0000-4000-8000-000000000001'''
\set ub '''b0000000-0000-4000-8000-000000000001'''
\set wa '''a0000000-0000-4000-8000-0000000000aa'''
\set wb '''b0000000-0000-4000-8000-0000000000bb'''
\set aa '''a0000000-0000-4000-8000-00000000a471'''
\set ab '''b0000000-0000-4000-8000-00000000b471'''
\set ba '''a0000000-0000-4000-8000-00000000b00a'''
\set bb '''b0000000-0000-4000-8000-00000000b00b'''
CREATE TABLE bb_test.before AS
  SELECT b.id, b.status, b.updated_at, a.updated_at AS artist_updated_at
  FROM public.bookings b JOIN public.artists a ON a.id = b.artist_id;

-- Preflight/postflight are single read-only SELECTs: wrap each in a temp view to assert on it.
-- (run-local.sh runs psql from tests/sql, so these shell paths are relative to it.)
\set preflight_sql `sed 's/;[[:space:]]*$//' ../../ops/supabase/booking-travel/preflight.sql`
\set postflight_sql `sed 's/;[[:space:]]*$//' ../../ops/supabase/booking-travel/postflight.sql`
CREATE TEMP VIEW preflight_before AS :preflight_sql ;
SELECT bb_test.eq('preflight: ready before 009',
  (SELECT item || ' ' || detail FROM preflight_before WHERE ord = 0), 'PREFLIGHT READY failing: none');
SELECT bb_test.eq('preflight: 009 objects absent before apply',
  (SELECT string_agg(detail, ',') FROM preflight_before WHERE section = '009'), 'absent,absent,absent,absent,absent,absent,absent,absent');
DROP VIEW preflight_before;

-- Guard: no explicit target, the production ref, and the staging ref on a development marker
-- are refused; nothing is created. (The file's own COMMIT ends the aborted transaction.)
\set ON_ERROR_STOP off
\o /dev/null
\ir ../../migrations/009_booking_travel_stays.sql
SET backbeat.booking_travel_target = 'hosted:jttrznlbbjyufzyqmzzs';
\ir ../../migrations/009_booking_travel_stays.sql
SET backbeat.booking_travel_target = 'hosted:hupkygptbvnzrihrlcxv';
\ir ../../migrations/009_booking_travel_stays.sql
SET backbeat.booking_lifecycle_target = 'development';
RESET backbeat.booking_travel_target;
\ir ../../migrations/009_booking_travel_stays.sql
\o
\set ON_ERROR_STOP on
SELECT bb_test.eq('guard: refused targets create nothing',
  ((SELECT count(*) FROM pg_class WHERE relname IN ('booking_travel_legs', 'booking_stays', 'artist_travel_documents'))
   + (SELECT count(*) FROM information_schema.columns WHERE table_name = 'artists' AND column_name = 'date_of_birth'))::text, '0');

-- Guard matrix on stand-in marker tables: only the exact marker of the named target applies.
ALTER TABLE public.runtime_environment RENAME TO runtime_environment_real;
CREATE TABLE public.runtime_environment (id text, environment text, synthetic_only boolean);
INSERT INTO public.runtime_environment VALUES ('backbeat-staging', 'staging', true);
SET backbeat.booking_travel_target = 'development';
\set ON_ERROR_STOP off
\o /dev/null
\ir ../../migrations/009_booking_travel_stays.sql
\o
\set ON_ERROR_STOP on
SELECT bb_test.eq('guard: staging marker + development target refused',
  (SELECT count(*)::text FROM pg_class WHERE relname = 'booking_travel_legs'), '0');
UPDATE public.runtime_environment SET synthetic_only = false;
SET backbeat.booking_travel_target = 'hosted:hupkygptbvnzrihrlcxv';
\set ON_ERROR_STOP off
\o /dev/null
\ir ../../migrations/009_booking_travel_stays.sql
\o
\set ON_ERROR_STOP on
SELECT bb_test.eq('guard: staging marker with synthetic_only false refused',
  (SELECT count(*)::text FROM pg_class WHERE relname = 'booking_travel_legs'), '0');
INSERT INTO public.runtime_environment VALUES ('backbeat-dev', 'development', true);
UPDATE public.runtime_environment SET synthetic_only = true;
\set ON_ERROR_STOP off
\o /dev/null
\ir ../../migrations/009_booking_travel_stays.sql
\o
\set ON_ERROR_STOP on
SELECT bb_test.eq('guard: two marker rows refused',
  (SELECT count(*)::text FROM pg_class WHERE relname = 'booking_travel_legs'), '0');
DROP TABLE public.runtime_environment;
\set ON_ERROR_STOP off
\o /dev/null
\ir ../../migrations/009_booking_travel_stays.sql
\o
\set ON_ERROR_STOP on
SELECT bb_test.eq('guard: absent marker table (production shape) refused',
  (SELECT count(*)::text FROM pg_class WHERE relname = 'booking_travel_legs'), '0');
CREATE TABLE public.runtime_environment (id text, environment text, synthetic_only boolean);
INSERT INTO public.runtime_environment VALUES ('backbeat-staging', 'staging', true);
\ir ../../migrations/009_booking_travel_stays.sql
SELECT bb_test.eq('guard: staging marker + staging target applies',
  (SELECT count(*)::text FROM pg_class WHERE relname IN ('booking_travel_legs', 'booking_stays', 'artist_travel_documents') AND relkind = 'r'), '3');
DROP TABLE public.booking_travel_legs, public.booking_stays, public.artist_travel_documents;
ALTER TABLE public.artists DROP COLUMN date_of_birth;
DROP TABLE public.runtime_environment;
ALTER TABLE public.runtime_environment_real RENAME TO runtime_environment;

-- 005 is required: without the bookings composite key the file refuses.
ALTER TABLE public.bookings DROP CONSTRAINT bookings_workspace_id_id_key;
SET backbeat.booking_travel_target = 'development';
\set ON_ERROR_STOP off
\o /dev/null
\ir ../../migrations/009_booking_travel_stays.sql
\o
\set ON_ERROR_STOP on
SELECT bb_test.eq('requires: 005 missing refused',
  (SELECT count(*)::text FROM pg_class WHERE relname = 'booking_travel_legs'), '0');
\ir ../../migrations/005_booking_workspace_key.sql

-- Apply, then apply again: idempotent, no existing row touched.
\ir ../../migrations/009_booking_travel_stays.sql
\ir ../../migrations/009_booking_travel_stays.sql
SELECT bb_test.eq('existing rows: bookings and artists untouched by 009',
  (SELECT count(*)::text FROM public.bookings b JOIN public.artists a ON a.id = b.artist_id
   JOIN bb_test.before o ON o.id = b.id
   WHERE b.status = o.status AND b.updated_at = o.updated_at AND a.updated_at = o.artist_updated_at
     AND a.date_of_birth IS NULL), '2');
SELECT bb_test.eq('schema: parent policies unchanged',
  (SELECT string_agg(tablename || ':' || policyname, ',' ORDER BY tablename) FROM pg_policies
   WHERE schemaname = 'public' AND tablename IN ('bookings', 'artists')), 'artists:artist_access,bookings:booking_access');
CREATE TEMP VIEW postflight_after AS :postflight_sql ;
SELECT bb_test.eq('postflight: OK after apply',
  (SELECT item || ' ' || detail FROM postflight_after WHERE ord = 0), 'POSTFLIGHT OK failing: none');
DROP VIEW postflight_after;
SELECT bb_test.eq('schema: anon has no access',
  (has_table_privilege('anon', 'public.booking_travel_legs', 'SELECT')
   OR has_table_privilege('anon', 'public.booking_stays', 'SELECT')
   OR has_table_privilege('anon', 'public.artist_travel_documents', 'SELECT'))::text, 'false');

-- Member A: create, read, update, delete through the API role; validation CHECKs.
DO $$
DECLARE
  ua uuid := 'a0000000-0000-4000-8000-000000000001';
  wa uuid := 'a0000000-0000-4000-8000-0000000000aa';
  aa uuid := 'a0000000-0000-4000-8000-00000000a471';
  ba uuid := 'a0000000-0000-4000-8000-00000000b00a';
  ins_leg text := 'INSERT INTO public.booking_travel_legs (workspace_id, booking_id, direction%s) VALUES (%L, %L, %L%s)';
BEGIN
  PERFORM bb_test.eq('leg: minimal insert', bb_test.run_as(ua, format(ins_leg, '', wa, ba, 'inbound', '')), 'OK:1');
  PERFORM bb_test.eq('leg: full insert', bb_test.run_as(ua, format(ins_leg,
    ', mode, carrier, reference, depart_place, depart_date, depart_time, depart_zone, arrive_place, arrive_date, arrive_time, arrive_zone, travellers, driver_name, driver_phone, notes',
    wa, ba, 'outbound', ', ''flight'', ''Carrier'', ''REF1'', ''Rome'', ''2030-05-02'', ''09:00'', ''CET'', ''London'', ''2030-05-02'', ''10:30'', ''GMT'', ''Artist + TM'', ''Driver'', ''+39 1'', ''note''')), 'OK:1');
  PERFORM bb_test.eq('leg: unknown direction', bb_test.run_as(ua, format(ins_leg, '', wa, ba, 'sideways', '')), '23514');
  PERFORM bb_test.eq('leg: time without date', bb_test.run_as(ua, format(ins_leg, ', depart_time', wa, ba, 'other', ', ''09:00''')), '23514');
  PERFORM bb_test.eq('leg: arrive date before depart date', bb_test.run_as(ua, format(ins_leg, ', depart_date, arrive_date', wa, ba, 'other', ', ''2030-05-02'', ''2030-05-01''')), '23514');
  PERFORM bb_test.eq('leg: same date, earlier arrival time, same zone', bb_test.run_as(ua, format(ins_leg, ', depart_date, depart_time, arrive_date, arrive_time', wa, ba, 'other', ', ''2030-05-02'', ''10:00'', ''2030-05-02'', ''09:00''')), '23514');
  PERFORM bb_test.eq('leg: same date, earlier local arrival, different zones', bb_test.run_as(ua, format(ins_leg, ', depart_date, depart_time, depart_zone, arrive_date, arrive_time, arrive_zone', wa, ba, 'other', ', ''2030-05-02'', ''10:00'', ''Tokyo'', ''2030-05-02'', ''09:00'', ''Honolulu''')), 'OK:1');
  PERFORM bb_test.eq('leg: zone labels compared case-insensitively', bb_test.run_as(ua, format(ins_leg, ', depart_date, depart_time, depart_zone, arrive_date, arrive_time, arrive_zone', wa, ba, 'other', ', ''2030-05-02'', ''10:00'', ''cet'', ''2030-05-02'', ''09:00'', '' CET ''')), '23514');
  -- Date-line rule (Simone 2026-11-23): one day earlier only with two different, set labels.
  PERFORM bb_test.eq('leg: date line, different zones, arrival one day earlier', bb_test.run_as(ua, format(ins_leg, ', depart_date, depart_time, depart_zone, arrive_date, arrive_time, arrive_zone', wa, ba, 'other', ', ''2030-05-02'', ''17:00'', ''Tokyo'', ''2030-05-01'', ''10:00'', ''Los Angeles''')), 'OK:1');
  PERFORM bb_test.eq('leg: date line, different zones, two days earlier', bb_test.run_as(ua, format(ins_leg, ', depart_date, depart_zone, arrive_date, arrive_zone', wa, ba, 'other', ', ''2030-05-02'', ''Tokyo'', ''2030-04-30'', ''Los Angeles''')), '23514');
  PERFORM bb_test.eq('leg: date line, one label missing, one day earlier', bb_test.run_as(ua, format(ins_leg, ', depart_date, depart_zone, arrive_date', wa, ba, 'other', ', ''2030-05-02'', ''Tokyo'', ''2030-05-01''')), '23514');
  PERFORM bb_test.eq('leg: date line, blank label counts as missing', bb_test.run_as(ua, format(ins_leg, ', depart_date, depart_zone, arrive_date, arrive_zone', wa, ba, 'other', ', ''2030-05-02'', ''  '', ''2030-05-01'', ''PST''')), '23514');
  PERFORM bb_test.eq('leg: date line, equal labels, one day earlier', bb_test.run_as(ua, format(ins_leg, ', depart_date, depart_zone, arrive_date, arrive_zone', wa, ba, 'other', ', ''2030-05-02'', ''JST'', ''2030-05-01'', '' jst ''')), '23514');
  PERFORM bb_test.eq('leg: one label missing, same date, earlier time', bb_test.run_as(ua, format(ins_leg, ', depart_date, depart_time, depart_zone, arrive_date, arrive_time', wa, ba, 'other', ', ''2030-05-02'', ''10:00'', ''CET'', ''2030-05-02'', ''09:00''')), '23514');
  PERFORM bb_test.eq('leg: date line across a month end', bb_test.run_as(ua, format(ins_leg, ', depart_date, depart_zone, arrive_date, arrive_zone', wa, ba, 'other', ', ''2030-03-01'', ''Auckland'', ''2030-02-28'', ''Honolulu''')), 'OK:1');
  PERFORM bb_test.eq('leg: notes too long', bb_test.run_as(ua, format(ins_leg, ', notes', wa, ba, 'other', format(', %L', repeat('x', 2001)))), '23514');
  PERFORM bb_test.eq('leg: booking of another workspace', bb_test.run_as(ua, format(ins_leg, '', wa, 'b0000000-0000-4000-8000-00000000b00b', 'other', '')), '23503');
  PERFORM bb_test.eq('leg: update a column', bb_test.run_as(ua, 'UPDATE public.booking_travel_legs SET notes = ''changed'', updated_at = now() WHERE direction = ''inbound'''), 'OK:1');
  PERFORM bb_test.eq('leg: cannot move to another booking', bb_test.run_as(ua, format('UPDATE public.booking_travel_legs SET booking_id = %L', ba)), '42501');
  PERFORM bb_test.eq('leg: cannot change workspace_id', bb_test.run_as(ua, format('UPDATE public.booking_travel_legs SET workspace_id = %L', wa)), '42501');

  PERFORM bb_test.eq('stay: insert', bb_test.run_as(ua, format('INSERT INTO public.booking_stays (workspace_id, booking_id, name, check_in_on, check_out_on) VALUES (%L, %L, ''Hotel'', ''2030-05-01'', ''2030-05-02'')', wa, ba)), 'OK:1');
  PERFORM bb_test.eq('stay: same-day check-out allowed', bb_test.run_as(ua, format('INSERT INTO public.booking_stays (workspace_id, booking_id, name, check_in_on, check_out_on) VALUES (%L, %L, ''Dayroom'', ''2030-05-01'', ''2030-05-01'')', wa, ba)), 'OK:1');
  PERFORM bb_test.eq('stay: check-out before check-in', bb_test.run_as(ua, format('INSERT INTO public.booking_stays (workspace_id, booking_id, name, check_in_on, check_out_on) VALUES (%L, %L, ''Hotel'', ''2030-05-02'', ''2030-05-01'')', wa, ba)), '23514');
  PERFORM bb_test.eq('stay: blank name', bb_test.run_as(ua, format('INSERT INTO public.booking_stays (workspace_id, booking_id, name) VALUES (%L, %L, ''  '')', wa, ba)), '23514');
  PERFORM bb_test.eq('stay: cannot move to another booking', bb_test.run_as(ua, format('UPDATE public.booking_stays SET booking_id = %L', ba)), '42501');

  PERFORM bb_test.eq('doc: insert', bb_test.run_as(ua, format('INSERT INTO public.artist_travel_documents (workspace_id, artist_id, doc_type, number, issuing_country, expires_on, holder_name) VALUES (%L, %L, ''passport'', ''YA0000001'', ''Italy'', ''2031-01-01'', ''Artist A'')', wa, aa)), 'OK:1');
  PERFORM bb_test.eq('doc: unknown type', bb_test.run_as(ua, format('INSERT INTO public.artist_travel_documents (workspace_id, artist_id, doc_type, number) VALUES (%L, %L, ''visa'', ''1'')', wa, aa)), '23514');
  PERFORM bb_test.eq('doc: blank number', bb_test.run_as(ua, format('INSERT INTO public.artist_travel_documents (workspace_id, artist_id, doc_type, number) VALUES (%L, %L, ''passport'', '' '')', wa, aa)), '23514');
  PERFORM bb_test.eq('doc: artist of another workspace', bb_test.run_as(ua, format('INSERT INTO public.artist_travel_documents (workspace_id, artist_id, doc_type, number) VALUES (%L, %L, ''passport'', ''1'')', wa, 'b0000000-0000-4000-8000-00000000b471')), '23503');
  PERFORM bb_test.eq('doc: cannot move to another artist', bb_test.run_as(ua, format('UPDATE public.artist_travel_documents SET artist_id = %L', aa)), '42501');
  PERFORM bb_test.eq('dob: member sets date of birth', bb_test.run_as(ua, format('UPDATE public.artists SET date_of_birth = ''1990-02-03'' WHERE id = %L', aa)), 'OK:1');
  PERFORM bb_test.eq('dob: before 1900 rejected', bb_test.run_as(ua, format('UPDATE public.artists SET date_of_birth = ''1899-12-31'' WHERE id = %L', aa)), '23514');
END
$$;

-- Workspace isolation for all three tables and the new artist column, both directions.
INSERT INTO public.booking_travel_legs (workspace_id, booking_id, direction) VALUES (:wb, :bb, 'inbound');
INSERT INTO public.booking_stays (workspace_id, booking_id, name) VALUES (:wb, :bb, 'Hotel B');
INSERT INTO public.artist_travel_documents (workspace_id, artist_id, doc_type, number) VALUES (:wb, :ab, 'id_card', 'B-1');
CREATE TABLE bb_test.counts AS SELECT
  (SELECT count(*) FROM public.booking_travel_legs) AS legs,
  (SELECT count(*) FROM public.booking_stays) AS stays,
  (SELECT count(*) FROM public.artist_travel_documents) AS docs;
DO $$
DECLARE
  ua uuid := 'a0000000-0000-4000-8000-000000000001';
  ub uuid := 'b0000000-0000-4000-8000-000000000001';
  wa uuid := 'a0000000-0000-4000-8000-0000000000aa';
  wb uuid := 'b0000000-0000-4000-8000-0000000000bb';
  aa uuid := 'a0000000-0000-4000-8000-00000000a471';
  ab uuid := 'b0000000-0000-4000-8000-00000000b471';
  ba uuid := 'a0000000-0000-4000-8000-00000000b00a';
  bb uuid := 'b0000000-0000-4000-8000-00000000b00b';
  t text;
  leak text := 'DO $t$ BEGIN IF EXISTS (SELECT 1 FROM public.%I WHERE workspace_id = %L) THEN RAISE EXCEPTION ''leak''; END IF; END $t$';
BEGIN
  FOREACH t IN ARRAY ARRAY['booking_travel_legs', 'booking_stays', 'artist_travel_documents'] LOOP
    PERFORM bb_test.eq('rls: B sees no ' || t || ' row of A', bb_test.run_as(ub, format(leak, t, wa)), 'OK:0');
    PERFORM bb_test.eq('rls: A sees no ' || t || ' row of B', bb_test.run_as(ua, format(leak, t, wb)), 'OK:0');
    PERFORM bb_test.eq('rls: no session sees no ' || t || ' row', bb_test.run_as(NULL, format('DO $t$ BEGIN IF EXISTS (SELECT 1 FROM public.%I) THEN RAISE EXCEPTION ''leak''; END IF; END $t$', t)), 'OK:0');
    PERFORM bb_test.eq('rls: B cannot update ' || t || ' of A', bb_test.run_as(ub, format('UPDATE public.%I SET updated_at = now() WHERE workspace_id = %L', t, wa)), 'OK:0');
    PERFORM bb_test.eq('rls: B cannot delete ' || t || ' of A', bb_test.run_as(ub, format('DELETE FROM public.%I WHERE workspace_id = %L', t, wa)), 'OK:0');
    PERFORM bb_test.eq('rls: no session cannot delete ' || t, bb_test.run_as(NULL, format('DELETE FROM public.%I', t)), 'OK:0');
  END LOOP;
  PERFORM bb_test.eq('rls: B cannot add a leg to A', bb_test.run_as(ub, format('INSERT INTO public.booking_travel_legs (workspace_id, booking_id, direction) VALUES (%L, %L, ''other'')', wa, ba)), '42501');
  PERFORM bb_test.eq('rls: B cannot add a stay to A', bb_test.run_as(ub, format('INSERT INTO public.booking_stays (workspace_id, booking_id, name) VALUES (%L, %L, ''x'')', wa, ba)), '42501');
  PERFORM bb_test.eq('rls: B cannot add a document to A', bb_test.run_as(ub, format('INSERT INTO public.artist_travel_documents (workspace_id, artist_id, doc_type, number) VALUES (%L, %L, ''other'', ''x'')', wa, aa)), '42501');
  PERFORM bb_test.eq('rls: B cannot attach own leg row to A booking', bb_test.run_as(ub, format('INSERT INTO public.booking_travel_legs (workspace_id, booking_id, direction) VALUES (%L, %L, ''other'')', wb, ba)), '23503');
  PERFORM bb_test.eq('rls: B cannot read A date of birth', bb_test.run_as(ub, format('DO $t$ BEGIN IF EXISTS (SELECT 1 FROM public.artists WHERE date_of_birth IS NOT NULL AND workspace_id = %L) THEN RAISE EXCEPTION ''leak''; END IF; END $t$', wa)), 'OK:0');
  PERFORM bb_test.eq('rls: B cannot set A date of birth', bb_test.run_as(ub, format('UPDATE public.artists SET date_of_birth = ''1980-01-01'' WHERE id = %L', aa)), 'OK:0');
  PERFORM bb_test.eq('rls: B edits own document', bb_test.run_as(ub, format('UPDATE public.artist_travel_documents SET number = ''B-2'', updated_at = now() WHERE workspace_id = %L', wb)), 'OK:1');
END
$$;
SELECT bb_test.eq('rls: row counts stable after foreign attempts',
  (SELECT (SELECT count(*) FROM public.booking_travel_legs) || ',' || (SELECT count(*) FROM public.booking_stays)
   || ',' || (SELECT count(*) FROM public.artist_travel_documents)),
  (SELECT legs || ',' || stays || ',' || docs FROM bb_test.counts));
SELECT bb_test.eq('dob: A value stored, B untouched',
  (SELECT string_agg(coalesce(date_of_birth::text, '-'), ',' ORDER BY name) FROM public.artists), '1990-02-03,-');

-- The staging verification script, against this database: all checks pass, nothing changes.
CREATE TABLE bb_test.snapshot AS SELECT
  (SELECT count(*) FROM public.bookings) AS bookings, (SELECT count(*) FROM public.artists) AS artists,
  (SELECT count(*) FROM public.booking_travel_legs) AS legs, (SELECT count(*) FROM public.booking_stays) AS stays,
  (SELECT count(*) FROM public.artist_travel_documents) AS docs;
\o /dev/null
\ir ../../ops/supabase/booking-travel/verify.sql
\o
SELECT bb_test.eq('verify.sql: every check passes',
  split_part(current_setting('backbeat.booking_travel_verify'), E'\n', 1), 'BOOKING_TRAVEL_VERIFY ALL PASS: pass=13 fail=0 skip=0');
SELECT bb_test.eq('verify.sql: one line per check',
  (array_length(string_to_array(current_setting('backbeat.booking_travel_verify'), E'\n'), 1))::text, '14');
SELECT bb_test.eq('verify.sql: nothing left behind',
  (SELECT row(s.*)::text FROM bb_test.snapshot s),
  (SELECT row((SELECT count(*) FROM public.bookings), (SELECT count(*) FROM public.artists),
    (SELECT count(*) FROM public.booking_travel_legs), (SELECT count(*) FROM public.booking_stays),
    (SELECT count(*) FROM public.artist_travel_documents))::text));
SELECT bb_test.eq('verify.sql: role restored', current_user::text, 'postgres');

-- Cascades as an ordinary member: booking delete removes legs and stays; artist delete
-- removes travel documents (and, through the existing cascade, the artist's bookings).
DO $$
DECLARE
  ua uuid := 'a0000000-0000-4000-8000-000000000001';
  ba uuid := 'a0000000-0000-4000-8000-00000000b00a';
  aa uuid := 'a0000000-0000-4000-8000-00000000a471';
  wa uuid := 'a0000000-0000-4000-8000-0000000000aa';
BEGIN
  PERFORM bb_test.eq('cascade: precondition A has legs and stays',
    ((SELECT count(*) FROM public.booking_travel_legs WHERE booking_id = ba) > 0
     AND (SELECT count(*) FROM public.booking_stays WHERE booking_id = ba) > 0)::text, 'true');
  PERFORM bb_test.eq('cascade: member deletes booking', bb_test.run_as(ua, format('DELETE FROM public.bookings WHERE id = %L', ba)), 'OK:1');
  PERFORM bb_test.eq('cascade: booking legs and stays removed',
    ((SELECT count(*) FROM public.booking_travel_legs WHERE booking_id = ba)
     + (SELECT count(*) FROM public.booking_stays WHERE booking_id = ba))::text, '0');
  PERFORM bb_test.eq('cascade: artist documents kept after booking delete',
    (SELECT count(*)::text FROM public.artist_travel_documents WHERE artist_id = aa), '1');
  INSERT INTO public.bookings (id, workspace_id, artist_id, date, start_time) VALUES (ba, wa, aa, '2030-06-01', '21:00');
  INSERT INTO public.booking_travel_legs (workspace_id, booking_id, direction) VALUES (wa, ba, 'inbound');
  INSERT INTO public.booking_stays (workspace_id, booking_id, name) VALUES (wa, ba, 'Hotel');
  PERFORM bb_test.eq('cascade: member deletes artist', bb_test.run_as(ua, format('DELETE FROM public.artists WHERE id = %L', aa)), 'OK:1');
  PERFORM bb_test.eq('cascade: artist documents, bookings, legs and stays removed',
    ((SELECT count(*) FROM public.artist_travel_documents WHERE artist_id = aa)
     + (SELECT count(*) FROM public.bookings WHERE artist_id = aa)
     + (SELECT count(*) FROM public.booking_travel_legs WHERE booking_id = ba)
     + (SELECT count(*) FROM public.booking_stays WHERE booking_id = ba))::text, '0');
  PERFORM bb_test.eq('cascade: workspace B untouched',
    ((SELECT count(*) FROM public.booking_travel_legs WHERE workspace_id <> wa)
     || ',' || (SELECT count(*) FROM public.booking_stays WHERE workspace_id <> wa)
     || ',' || (SELECT count(*) FROM public.artist_travel_documents WHERE workspace_id <> wa)), '1,1,1');
END
$$;

-- Rollback parks the data (no loss), hides it from the API; 009 + restore bring it back.
UPDATE public.artists SET date_of_birth = '1985-07-08' WHERE id = :ab;
\ir ../../ops/supabase/booking-travel/rollback.sql
SELECT bb_test.eq('rollback: live tables and column gone',
  ((SELECT count(*) FROM pg_class WHERE relname IN ('booking_travel_legs', 'booking_stays', 'artist_travel_documents'))
   + (SELECT count(*) FROM information_schema.columns WHERE table_name = 'artists' AND column_name = 'date_of_birth'))::text, '0');
SELECT bb_test.eq('rollback: data parked',
  (SELECT (SELECT count(*) FROM public.booking_travel_legs_rollback_backup) || ',' || (SELECT count(*) FROM public.booking_stays_rollback_backup)
   || ',' || (SELECT count(*) FROM public.artist_travel_documents_rollback_backup) || ',' || (SELECT count(*) FROM public.artists_date_of_birth_rollback_backup)),
  '1,1,1,1');
SELECT bb_test.eq('rollback: backups hidden from API roles',
  bb_test.run_as(:ub, 'SELECT 1 FROM public.booking_travel_legs_rollback_backup UNION ALL SELECT 1 FROM public.artist_travel_documents_rollback_backup'), '42501');
SELECT bb_test.eq('rollback: dob backup hidden from API roles',
  bb_test.run_as(:ub, 'SELECT 1 FROM public.artists_date_of_birth_rollback_backup'), '42501');
\ir ../../ops/supabase/booking-travel/rollback.sql
SELECT bb_test.eq('rollback: second run is a no-op',
  (SELECT count(*)::text FROM public.artists_date_of_birth_rollback_backup), '1');
\ir ../../migrations/009_booking_travel_stays.sql
\ir ../../ops/supabase/booking-travel/restore.sql
SELECT bb_test.eq('restore: rows and date of birth back',
  (SELECT (SELECT count(*) FROM public.booking_travel_legs) || ',' || (SELECT count(*) FROM public.booking_stays)
   || ',' || (SELECT number FROM public.artist_travel_documents) || ',' || (SELECT date_of_birth::text FROM public.artists WHERE id = :ab)),
  '1,1,B-2,1985-07-08');
SELECT bb_test.eq('restore: backups dropped',
  (SELECT count(*)::text FROM pg_class WHERE relname LIKE '%rollback_backup' AND relname NOT LIKE 'bookings_lifecycle%'), '0');
CREATE TEMP VIEW postflight_restored AS :postflight_sql ;
SELECT bb_test.eq('restore: postflight OK',
  (SELECT item || ' ' || detail FROM postflight_restored WHERE ord = 0), 'POSTFLIGHT OK failing: none');
SELECT bb_test.eq('restore: B sees its restored leg',
  bb_test.run_as(:ub, 'DO $t$ BEGIN IF (SELECT count(*) FROM public.booking_travel_legs) <> 1 THEN RAISE EXCEPTION ''missing''; END IF; END $t$'), 'OK:0');

-- Rollback and restore carry the same guard: refused on a production-shaped database.
ALTER TABLE public.runtime_environment RENAME TO runtime_environment_real;
\set ON_ERROR_STOP off
\o /dev/null
\ir ../../ops/supabase/booking-travel/rollback.sql
\ir ../../ops/supabase/booking-travel/restore.sql
\o
\set ON_ERROR_STOP on
ALTER TABLE public.runtime_environment_real RENAME TO runtime_environment;
SELECT bb_test.eq('guard: rollback refused without a marker, schema intact',
  (SELECT count(*)::text FROM pg_class WHERE relname IN ('booking_travel_legs', 'booking_stays', 'artist_travel_documents') AND relkind = 'r'), '3');
\echo BOOKING_TRAVEL_SQL_TESTS_PASSED
