-- SQL contract test for the travel-document part of migration 009 (owner decision on PR #36,
-- D1-D6). Labels start with the verification-plan ID they give LOCAL_INPROCESS evidence for.
-- Run through tests/sql/run-local.sh travel-documents on a throwaway local cluster; never hosted.
-- The auth and storage schemas are stubs: no Supabase Auth, PostgREST or Storage API runs here,
-- so nothing in this file is evidence for the HOSTED_STAGING cases (HOST-*, URL-02/03, FILE-02/03).
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
-- Staging order: 001-008 and 010 are applied; 009 applies after them.
SET backbeat.booking_finance_target = 'development';
\ir ../../migrations/007_booking_finance.sql
\ir ../../ops/supabase/booking-finance/007-forward-payment-history.sql
SET backbeat.booking_payment_history_target = 'development';
\ir ../../migrations/010_booking_payment_history.sql
SET backbeat.booking_event_target = 'development';
\ir ../../migrations/008_booking_event.sql

-- Stand-in for the Storage catalog: rows are "objects in the bucket". Never the Storage API.
CREATE SCHEMA storage;
CREATE TABLE storage.buckets (id text PRIMARY KEY, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
CREATE TABLE storage.objects (bucket_id text NOT NULL, name text NOT NULL, PRIMARY KEY (bucket_id, name));
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
GRANT USAGE ON SCHEMA storage TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO anon, authenticated;

SET backbeat.booking_travel_target = 'development';
\ir ../../migrations/009_booking_travel_stays.sql
CREATE EXTENSION dblink;

CREATE TABLE bb_test.ids (k text PRIMARY KEY, v uuid NOT NULL);
INSERT INTO bb_test.ids VALUES
  ('wa', 'a0000000-0000-4000-8000-0000000000aa'), ('wb', 'b0000000-0000-4000-8000-0000000000bb'),
  ('master', 'a0000000-0000-4000-8000-000000000001'), ('admin', 'a0000000-0000-4000-8000-000000000002'),
  ('member', 'a0000000-0000-4000-8000-000000000003'), ('inactive', 'a0000000-0000-4000-8000-000000000004'),
  ('pending', 'a0000000-0000-4000-8000-000000000005'), ('ub', 'b0000000-0000-4000-8000-000000000001'),
  ('dual', 'd0000000-0000-4000-8000-000000000001'), ('outsider', 'e0000000-0000-4000-8000-000000000001'),
  ('a1', 'a0000000-0000-4000-8000-00000000a471'), ('a2', 'a0000000-0000-4000-8000-00000000a472'),
  ('ab', 'b0000000-0000-4000-8000-00000000b471'),
  ('b1', 'a0000000-0000-4000-8000-00000000b001'), ('b2', 'a0000000-0000-4000-8000-00000000b002'),
  ('bb', 'b0000000-0000-4000-8000-00000000b00b'),
  ('e1', 'a0000000-0000-4000-8000-00000000e001'), ('e2', 'a0000000-0000-4000-8000-00000000e002');
CREATE FUNCTION bb_test.id(key text) RETURNS uuid LANGUAGE sql STABLE
AS $$ SELECT v FROM bb_test.ids WHERE k = key $$;

INSERT INTO auth.users (id, email, email_confirmed_at)
  SELECT v, k || '@example.test', now() FROM bb_test.ids
  WHERE k IN ('master', 'admin', 'member', 'inactive', 'pending', 'ub', 'dual', 'outsider');
INSERT INTO public.workspaces (id, name, created_by) VALUES
  (bb_test.id('wa'), 'Workspace A', bb_test.id('master')), (bb_test.id('wb'), 'Workspace B', bb_test.id('ub'));
INSERT INTO public.workspace_members (workspace_id, user_id, role, status) VALUES
  (bb_test.id('wa'), bb_test.id('master'), 'master', 'active'), (bb_test.id('wa'), bb_test.id('admin'), 'admin', 'active'),
  (bb_test.id('wa'), bb_test.id('member'), 'member', 'active'), (bb_test.id('wa'), bb_test.id('inactive'), 'member', 'inactive'),
  (bb_test.id('wa'), bb_test.id('pending'), 'member', 'pending'), (bb_test.id('wb'), bb_test.id('ub'), 'master', 'active'),
  (bb_test.id('wa'), bb_test.id('dual'), 'member', 'active'), (bb_test.id('wb'), bb_test.id('dual'), 'member', 'active');
INSERT INTO public.artists (id, workspace_id, name) VALUES
  (bb_test.id('a1'), bb_test.id('wa'), 'Artist A1'), (bb_test.id('a2'), bb_test.id('wa'), 'Artist A2'),
  (bb_test.id('ab'), bb_test.id('wb'), 'Artist B');
INSERT INTO public.bookings (id, workspace_id, artist_id, date, start_time) VALUES
  (bb_test.id('b1'), bb_test.id('wa'), bb_test.id('a1'), '2030-05-01', '21:00'),
  (bb_test.id('b2'), bb_test.id('wa'), bb_test.id('a2'), '2030-05-01', '21:00'),
  (bb_test.id('bb'), bb_test.id('wb'), bb_test.id('ab'), '2030-05-01', '21:00');
INSERT INTO public.events (id, workspace_id, title, date, artist_id) VALUES
  (bb_test.id('e1'), bb_test.id('wa'), 'Event A1', '2030-05-01', bb_test.id('a1')),
  (bb_test.id('e2'), bb_test.id('wa'), 'Event A2', '2030-05-01', bb_test.id('a2'));

-- One query as an API role; returns the first column of the first row, or the SQLSTATE.
CREATE FUNCTION bb_test.q(api_role text, actor uuid, query text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE result text;
BEGIN
  BEGIN
    PERFORM set_config('request.jwt.claim.sub', coalesce(actor::text, ''), true);
    EXECUTE format('SET LOCAL ROLE %I', api_role);
    EXECUTE query INTO result;
    EXECUTE 'RESET ROLE';
    PERFORM set_config('request.jwt.claim.sub', '', true);
    RETURN coalesce(result, 'NULL');
  EXCEPTION WHEN OTHERS THEN
    EXECUTE 'RESET ROLE';
    PERFORM set_config('request.jwt.claim.sub', '', true);
    RETURN SQLSTATE;
  END;
END
$$;
-- The browser session of a user / the trusted server role (no session user).
CREATE FUNCTION bb_test.mem(who text, query text) RETURNS text LANGUAGE sql
AS $$ SELECT bb_test.q('authenticated', bb_test.id(who), query) $$;
CREATE FUNCTION bb_test.svc(query text) RETURNS text LANGUAGE sql
AS $$ SELECT bb_test.q('service_role', NULL, query) $$;

-- A member creates a card through the API role (audited by the trigger).
CREATE FUNCTION bb_test.card(who text, workspace text, artist text, doc_number text, expires date DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE out text;
BEGIN
  out := bb_test.mem(who, format(
    'INSERT INTO public.artist_travel_documents (workspace_id, artist_id, doc_type, number, expires_on) VALUES (%L, %L, ''passport'', %L, %L) RETURNING id',
    bb_test.id(workspace), bb_test.id(artist), doc_number, expires));
  RETURN out::uuid;
END
$$;
-- The trusted server path publishes one validated scan for a card and "stores" its object.
CREATE FUNCTION bb_test.scan(who text, workspace text, doc uuid, digest text DEFAULT repeat('a', 64))
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE new_file uuid; outcome text;
BEGIN
  new_file := bb_test.svc(format('SELECT file_id FROM public.backbeat_travel_document_reserve_upload(%L, %L, %L)',
    bb_test.id(who), bb_test.id(workspace), doc))::uuid;
  INSERT INTO storage.objects (bucket_id, name)
    SELECT 'artist-travel-documents', object_key FROM public.artist_travel_document_files WHERE id = new_file;
  outcome := bb_test.svc(format('SELECT public.backbeat_travel_document_finalize_upload(%L, %L, %L, ''application/pdf'', 1234, %L)',
    bb_test.id(who), bb_test.id(workspace), new_file, digest));
  IF outcome <> 'ready' THEN RAISE EXCEPTION 'fixture scan not ready: %', outcome; END IF;
  RETURN new_file;
END
$$;
CREATE FUNCTION bb_test.authorize(who text, workspace text, file uuid, request uuid, booking uuid DEFAULT NULL, event uuid DEFAULT NULL)
RETURNS text LANGUAGE sql AS $$
  SELECT bb_test.svc(format('SELECT document_generation FROM public.backbeat_travel_document_authorize_download(%L, %L, %L, %L, %L, %L)',
    bb_test.id(who), bb_test.id(workspace), file, request, booking, event))
$$;
CREATE FUNCTION bb_test.issue(who text, workspace text, file uuid, request uuid, generation bigint, signed boolean DEFAULT true)
RETURNS text LANGUAGE sql AS $$
  SELECT bb_test.svc(format('SELECT public.backbeat_travel_document_record_issuance(%L, %L, %L, %L, %L, %L)',
    bb_test.id(who), bb_test.id(workspace), file, request, generation, signed))
$$;
-- VOLATILE on purpose: each call must see the effects of the calls before it in the same statement.
CREATE FUNCTION bb_test.doc_state(doc uuid) RETURNS text LANGUAGE sql
AS $$ SELECT state || '/' || generation FROM public.artist_travel_documents WHERE id = doc $$;
CREATE FUNCTION bb_test.file_state(file uuid) RETURNS text LANGUAGE sql
AS $$ SELECT state FROM public.artist_travel_document_files WHERE id = file $$;
CREATE FUNCTION bb_test.events(doc uuid) RETURNS text LANGUAGE sql
AS $$ SELECT coalesce(string_agg(action || coalesce(':' || detail, ''), ',' ORDER BY seq), '')
     FROM public.artist_travel_document_audit WHERE document_id = doc $$;
-- Lock barrier: waits until another session is blocked on a lock held by this one.
CREATE FUNCTION bb_test.wait_blocked() RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  FOR i IN 1..200 LOOP
    IF EXISTS (SELECT 1 FROM pg_locks WHERE NOT granted) THEN RETURN 'blocked'; END IF;
    PERFORM pg_sleep(0.025);
  END LOOP;
  RETURN 'not blocked';
END
$$;
CREATE FUNCTION bb_test.other_result() RETURNS text LANGUAGE plpgsql AS $$
DECLARE result text;
BEGIN
  SELECT r INTO result FROM dblink_get_result('other') AS t(r text);
  PERFORM * FROM dblink_get_result('other') AS t(r text);
  RETURN result;
END
$$;
SELECT dblink_connect('other', 'dbname=postgres user=postgres host=' || :'socket_dir');
CREATE TABLE bb_test.keep (k text PRIMARY KEY, v text);

-- ---------------------------------------------------------------------------------------------
-- ACL-01 / ACL-02 / ACL-03 / HOST-04 (local shape only): effective privileges and entry points.
-- ---------------------------------------------------------------------------------------------
\set postflight_sql `sed 's/;[[:space:]]*$//' ../../ops/supabase/booking-travel/postflight.sql`
CREATE TEMP VIEW postflight_now AS :postflight_sql ;
SELECT bb_test.eq('ACL-01 postflight: RLS, policies, grants, triggers and function callers as designed',
  (SELECT item || ' ' || detail FROM postflight_now WHERE ord = 0), 'POSTFLIGHT OK failing: none');
SELECT bb_test.eq('ACL-01 untouched surfaces keep their ACLs (artists, bookings)',
  (SELECT string_agg(c.relname || '=' || (SELECT string_agg(p, ',' ORDER BY p) FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE']) p
     WHERE has_table_privilege('authenticated', c.oid, p)), ' ' ORDER BY c.relname)
   FROM pg_class c WHERE c.oid IN ('public.artists'::regclass, 'public.bookings'::regclass)),
  'artists=DELETE,INSERT,SELECT,UPDATE bookings=DELETE,INSERT,SELECT,UPDATE');
SELECT bb_test.eq('ACL-01 no API role holds a privilege on the audit sequence',
  (SELECT string_agg(r, ',') FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) r
   WHERE has_sequence_privilege(r, pg_get_serial_sequence('public.artist_travel_document_audit', 'seq'), 'USAGE')
      OR has_sequence_privilege(r, pg_get_serial_sequence('public.artist_travel_document_audit', 'seq'), 'UPDATE')), NULL);
SELECT bb_test.eq('ACL-02 every SECURITY DEFINER function of 009 pins an empty search_path',
  (SELECT count(*)::text FROM pg_proc WHERE proname LIKE 'backbeat\_travel\_document\_%' AND prosecdef
     AND NOT coalesce(proconfig, '{}') @> ARRAY['search_path=""']), '0');
SELECT bb_test.eq('CORE-06 no entry point takes a written reason (no text parameter except fixed codes)',
  (SELECT string_agg(proname, ',' ORDER BY proname) FROM pg_proc
   WHERE proname LIKE 'backbeat\_travel\_document\_%' AND pg_get_function_identity_arguments(oid) ~ 'reason'
     AND proname <> 'backbeat_travel_document_finalize_upload'), NULL);

DO $$
DECLARE
  doc uuid := bb_test.card('master', 'wa', 'a1', 'ACL-0001');
  file uuid := bb_test.scan('master', 'wa', doc);
  wa uuid := bb_test.id('wa');
  who text;
BEGIN
  INSERT INTO bb_test.keep VALUES ('acl_doc', doc::text), ('acl_file', file::text);
  -- ACL-03 / AUD-02: denied by privilege (42501), not by an RLS-filtered zero-row statement.
  FOREACH who IN ARRAY ARRAY['master', 'admin', 'member'] LOOP
    PERFORM bb_test.eq('AUD-02 ' || who || ': audit INSERT denied', bb_test.mem(who, format(
      'INSERT INTO public.artist_travel_document_audit (workspace_id, artist_id, document_id, actor_id, action) VALUES (%L, %L, %L, %L, ''download_issued'') RETURNING id',
      wa, bb_test.id('a1'), doc, bb_test.id(who))), '42501');
    PERFORM bb_test.eq('ACL-03 ' || who || ': audit UPDATE denied', bb_test.mem(who, 'UPDATE public.artist_travel_document_audit SET action = ''card_created'' RETURNING id'), '42501');
    PERFORM bb_test.eq('ACL-03 ' || who || ': audit DELETE denied', bb_test.mem(who, 'DELETE FROM public.artist_travel_document_audit RETURNING id'), '42501');
    PERFORM bb_test.eq('ACL-03 ' || who || ': audit TRUNCATE denied', bb_test.run_as(bb_test.id(who), 'TRUNCATE public.artist_travel_document_audit'), '42501');
    PERFORM bb_test.eq('ACL-03 ' || who || ': card DELETE denied', bb_test.mem(who, format('DELETE FROM public.artist_travel_documents WHERE id = %L RETURNING id', doc)), '42501');
    PERFORM bb_test.eq('ACL-03 ' || who || ': lifecycle columns not writable', bb_test.mem(who, format('UPDATE public.artist_travel_documents SET state = ''purged'' WHERE id = %L RETURNING id', doc)), '42501');
    PERFORM bb_test.eq('ACL-03 ' || who || ': cannot repoint the current scan', bb_test.mem(who, format('UPDATE public.artist_travel_documents SET current_file_id = NULL WHERE id = %L RETURNING id', doc)), '42501');
    PERFORM bb_test.eq('ACL-03 ' || who || ': cannot insert a card in a chosen state', bb_test.mem(who, format(
      'INSERT INTO public.artist_travel_documents (workspace_id, artist_id, doc_type, number, state) VALUES (%L, %L, ''passport'', ''X'', ''active'') RETURNING id', wa, bb_test.id('a1'))), '42501');
    PERFORM bb_test.eq('ACL-03 ' || who || ': scan rows INSERT denied', bb_test.mem(who, format(
      'INSERT INTO public.artist_travel_document_files (workspace_id, artist_id, document_id, object_key, reserved_generation, reserved_by) VALUES (%L, %L, %L, ''k'', 1, %L) RETURNING id', wa, bb_test.id('a1'), doc, bb_test.id(who))), '42501');
    PERFORM bb_test.eq('ACL-03 ' || who || ': scan rows UPDATE denied', bb_test.mem(who, 'UPDATE public.artist_travel_document_files SET state = ''ready'' RETURNING id'), '42501');
    PERFORM bb_test.eq('ACL-03 ' || who || ': scan rows DELETE denied', bb_test.mem(who, 'DELETE FROM public.artist_travel_document_files RETURNING id'), '42501');
    PERFORM bb_test.eq('ACL-03 ' || who || ': Storage key is not readable', bb_test.mem(who, 'SELECT object_key FROM public.artist_travel_document_files LIMIT 1'), '42501');
    PERFORM bb_test.eq('ACL-03 ' || who || ': digest is not readable', bb_test.mem(who, 'SELECT sha256 FROM public.artist_travel_document_files LIMIT 1'), '42501');
    PERFORM bb_test.eq('ACL-03 ' || who || ': scan metadata is readable', bb_test.mem(who, format('SELECT state || ''/'' || media_type || ''/'' || byte_size FROM public.artist_travel_document_files WHERE id = %L', file)), 'ready/application/pdf/1234');
    PERFORM bb_test.eq('ACL-03 ' || who || ': relationship row not writable', bb_test.mem(who, format(
      'INSERT INTO public.artist_travel_document_relationships (workspace_id, artist_id, ended_at) VALUES (%L, %L, now()) RETURNING artist_id', wa, bb_test.id('a1'))), '42501');
    -- ACL-02: the trusted writer, the signer boundary and the purge are not callable from a session.
    PERFORM bb_test.eq('ACL-02 ' || who || ': authorize_download not callable', bb_test.mem(who, format(
      'SELECT object_key FROM public.backbeat_travel_document_authorize_download(%L, %L, %L, gen_random_uuid())', bb_test.id(who), wa, file)), '42501');
    PERFORM bb_test.eq('ACL-02 ' || who || ': record_issuance not callable', bb_test.mem(who, format(
      'SELECT public.backbeat_travel_document_record_issuance(%L, %L, %L, gen_random_uuid(), 1, true)', bb_test.id(who), wa, file)), '42501');
    PERFORM bb_test.eq('ACL-02 ' || who || ': reserve_upload not callable', bb_test.mem(who, format(
      'SELECT file_id FROM public.backbeat_travel_document_reserve_upload(%L, %L, %L)', bb_test.id(who), wa, doc)), '42501');
    PERFORM bb_test.eq('ACL-02 ' || who || ': audit writer not callable', bb_test.mem(who, format(
      'SELECT public.backbeat_travel_document_audit_write(%L, %L, %L, NULL, %L, ''download_issued'')', wa, bb_test.id('a1'), doc, bb_test.id(who))), '42501');
    PERFORM bb_test.eq('ACL-02 ' || who || ': purge claim not callable', bb_test.mem(who, 'SELECT public.backbeat_travel_document_purge_claim()'), '42501');
    PERFORM bb_test.eq('ACL-02 ' || who || ': purge confirm not callable', bb_test.mem(who, format('SELECT public.backbeat_travel_document_purge_confirm(%L, ''artist-travel-documents'')', file)), '42501');
    PERFORM bb_test.eq('ACL-02 ' || who || ': audit retention purge not callable', bb_test.mem(who, 'SELECT public.backbeat_travel_document_audit_retention_purge(now() - interval ''30 months'')'), '42501');
  END LOOP;
  PERFORM bb_test.eq('ACL-02 anon: no entry point', bb_test.q('anon', NULL, format('SELECT public.backbeat_travel_document_archive(%L, %L)', wa, doc)), '42501');
  PERFORM bb_test.eq('ACL-01 anon: no card read', bb_test.q('anon', NULL, 'SELECT count(*) FROM public.artist_travel_documents'), '42501');
  -- The trusted server role has no table privilege: it can only go through the functions.
  PERFORM bb_test.eq('ACL-03 server role: no direct audit insert', bb_test.svc(format(
    'INSERT INTO public.artist_travel_document_audit (workspace_id, artist_id, action) VALUES (%L, %L, ''download_issued'') RETURNING id', wa, bb_test.id('a1'))), '42501');
  PERFORM bb_test.eq('AUD-04 server role: no audit UPDATE', bb_test.svc('UPDATE public.artist_travel_document_audit SET detail = NULL RETURNING id'), '42501');
  PERFORM bb_test.eq('AUD-04 server role: no audit DELETE', bb_test.svc('DELETE FROM public.artist_travel_document_audit RETURNING id'), '42501');
  PERFORM bb_test.eq('ACL-03 server role: no direct card read or write', bb_test.svc('SELECT count(*) FROM public.artist_travel_documents'), '42501');
  PERFORM bb_test.eq('ACL-03 server role: no direct scan row write', bb_test.svc('UPDATE public.artist_travel_document_files SET state = ''ready'' RETURNING id'), '42501');
  PERFORM bb_test.eq('ACL-02 server role: member entry points are not its path', bb_test.svc(format('SELECT public.backbeat_travel_document_archive(%L, %L)', wa, doc)), '42501');
  PERFORM bb_test.eq('ACL-03 trusted writer positive: authorized path still works',
    bb_test.authorize('member', 'wa', file, gen_random_uuid()), '1');
END
$$;

-- ---------------------------------------------------------------------------------------------
-- CORE-01 / CORE-03 / DATA-01: who may do what on cards; fields.
-- ---------------------------------------------------------------------------------------------
DO $$
DECLARE
  wa uuid := bb_test.id('wa');
  a1 uuid := bb_test.id('a1');
  doc uuid;
  who text;
  ins text := 'INSERT INTO public.artist_travel_documents (workspace_id, artist_id, doc_type, number%s) VALUES (%L, %L, ''passport'', %L%s) RETURNING id';
BEGIN
  FOREACH who IN ARRAY ARRAY['master', 'admin', 'member', 'dual'] LOOP
    doc := bb_test.card(who, 'wa', 'a1', 'CORE-' || who);
    PERFORM bb_test.eq('CORE-01 ' || who || ': creates a card', (doc IS NOT NULL)::text, 'true');
    PERFORM bb_test.eq('CORE-01 ' || who || ': edits a card', bb_test.mem(who, format('UPDATE public.artist_travel_documents SET holder_name = ''NAME AS PRINTED'', updated_at = now() WHERE id = %L RETURNING id', doc)), doc::text);
    PERFORM bb_test.eq('CORE-01 ' || who || ': archives (recoverable delete)', bb_test.mem(who, format('SELECT public.backbeat_travel_document_archive(%L, %L)', wa, doc)), 'archived');
    PERFORM bb_test.eq('CORE-01 ' || who || ': archived card is not editable in place', bb_test.mem(who, format('UPDATE public.artist_travel_documents SET number = ''X'' WHERE id = %L RETURNING id', doc)), 'NULL');
    PERFORM bb_test.eq('CORE-01 ' || who || ': restores', bb_test.mem(who, format('SELECT public.backbeat_travel_document_restore(%L, %L)', wa, doc)), 'restored');
    PERFORM bb_test.eq('AUD-03 ' || who || ': every step audited with the session user, in order',
      (SELECT string_agg(action, ',' ORDER BY seq) || '|' || bool_and(actor_id = bb_test.id(who) AND workspace_id = wa AND artist_id = a1 AND occurred_at <= clock_timestamp())
       FROM public.artist_travel_document_audit WHERE document_id = doc), 'card_created,card_updated,archived,restored|true');
  END LOOP;
  INSERT INTO bb_test.keep VALUES ('core_doc', doc::text);
  -- Ineligible actors: inactive, pending, no membership, member of another workspace only.
  FOREACH who IN ARRAY ARRAY['inactive', 'pending', 'outsider', 'ub'] LOOP
    PERFORM bb_test.eq('CORE-01 ' || who || ': cannot create a card', bb_test.mem(who, format(ins, '', wa, a1, 'NO', '')), '42501');
    PERFORM bb_test.eq('CORE-01 ' || who || ': sees no card', bb_test.mem(who, format('SELECT count(*) FROM public.artist_travel_documents WHERE workspace_id = %L', wa)), '0');
    PERFORM bb_test.eq('CORE-01 ' || who || ': cannot edit', bb_test.mem(who, format('UPDATE public.artist_travel_documents SET number = ''X'' WHERE id = %L RETURNING id', doc)), 'NULL');
    PERFORM bb_test.eq('CORE-01 ' || who || ': cannot archive', bb_test.mem(who, format('SELECT public.backbeat_travel_document_archive(%L, %L)', wa, doc)), 'BB014');
    PERFORM bb_test.eq('CORE-01 ' || who || ': cannot restore', bb_test.mem(who, format('SELECT public.backbeat_travel_document_restore(%L, %L)', wa, doc)), 'BB014');
    PERFORM bb_test.eq('CORE-01 ' || who || ': cannot end the relationship', bb_test.mem(who, format('SELECT public.backbeat_travel_document_relationship_end(%L, %L)', wa, a1)), 'BB014');
    PERFORM bb_test.eq('CORE-03 ' || who || ': trusted path re-reads membership', bb_test.svc(format('SELECT file_id FROM public.backbeat_travel_document_reserve_upload(%L, %L, %L)', bb_test.id(who), wa, doc)), 'BB013');
  END LOOP;
  PERFORM bb_test.eq('CORE-02 workspace B member: own workspace id with a card of A answers not found',
    bb_test.mem('ub', format('SELECT public.backbeat_travel_document_archive(%L, %L)', bb_test.id('wb'), doc)), 'BB014');
  PERFORM bb_test.eq('CORE-02 dual member: card of A is not reachable through workspace B',
    bb_test.mem('dual', format('SELECT public.backbeat_travel_document_archive(%L, %L)', bb_test.id('wb'), doc)), 'BB014');
  UPDATE public.artist_travel_document_relationships SET ended_at = now() WHERE false;
  INSERT INTO public.artist_travel_document_relationships (workspace_id, artist_id, ended_at) VALUES (wa, a1, now());
  PERFORM bb_test.eq('CORE-01 a non-member learns nothing from an insert, even when the relationship is ended (42501, not BB019)',
    bb_test.mem('ub', format(ins, '', wa, a1, 'NO', '')) || '|' || bb_test.mem('member', format(ins, '', wa, a1, 'NO', '')), '42501|BB019');
  DELETE FROM public.artist_travel_document_relationships WHERE workspace_id = wa AND artist_id = a1;
  PERFORM bb_test.eq('CORE-01 ineligible attempts left no audit row',
    (SELECT count(*)::text FROM public.artist_travel_document_audit WHERE actor_id IN (bb_test.id('inactive'), bb_test.id('pending'), bb_test.id('outsider'), bb_test.id('ub'))), '0');

  -- DATA-01: nullable nationality and issue date; real dates only; fields independent.
  doc := bb_test.mem('member', format(ins, ', nationality, issued_on, issuing_country, expires_on, holder_name', wa, a1, 'DATA-1',
    ', ''Italian'', ''2024-02-29'', ''France'', ''2034-02-28'', ''ROSSI MARIO''')) ::uuid;
  PERFORM bb_test.eq('DATA-01 nationality and issued_on stored next to issuing country, expiry and printed name',
    (SELECT nationality || '|' || issued_on || '|' || issuing_country || '|' || expires_on || '|' || holder_name FROM public.artist_travel_documents WHERE id = doc),
    'Italian|2024-02-29|France|2034-02-28|ROSSI MARIO');
  PERFORM bb_test.eq('DATA-01 both new fields are optional', (bb_test.mem('member', format(ins, '', wa, a1, 'DATA-2', '')) ~ '^[0-9a-f-]{36}$')::text, 'true');
  PERFORM bb_test.eq('DATA-01 impossible issue date rejected by the type', bb_test.mem('member', format(ins, ', issued_on', wa, a1, 'DATA-3', ', ''2023-02-29''')), '22008');
  PERFORM bb_test.eq('DATA-01 nationality too long rejected', bb_test.mem('member', format(ins, ', nationality', wa, a1, 'DATA-4', format(', %L', repeat('x', 101)))), '23514');
  PERFORM bb_test.eq('DATA-01 changing nationality leaves issuing country and dates alone',
    bb_test.mem('member', format('UPDATE public.artist_travel_documents SET nationality = ''Swiss'' WHERE id = %L RETURNING nationality || ''|'' || issuing_country || ''|'' || issued_on || ''|'' || expires_on', doc)),
    'Swiss|France|2024-02-29|2034-02-28');
  PERFORM bb_test.eq('DATA-01 date-only value is calendar-stable in another session time zone',
    bb_test.mem('member', format('SET LOCAL TimeZone = ''Pacific/Kiritimati''; SELECT issued_on::text FROM public.artist_travel_documents WHERE id = %L', doc)), '2024-02-29');
END
$$;

-- ---------------------------------------------------------------------------------------------
-- AUD-01: reader sets.
-- ---------------------------------------------------------------------------------------------
DO $$
DECLARE
  docb uuid := bb_test.card('ub', 'wb', 'ab', 'B-0001');
  total_a text := (SELECT count(*)::text FROM public.artist_travel_document_audit WHERE workspace_id = bb_test.id('wa'));
  total_b text := (SELECT count(*)::text FROM public.artist_travel_document_audit WHERE workspace_id = bb_test.id('wb'));
  who text;
BEGIN
  FOREACH who IN ARRAY ARRAY['master', 'admin', 'member'] LOOP
    PERFORM bb_test.eq('AUD-01 ' || who || ' of A reads every audit row of A and none of B',
      bb_test.mem(who, format('SELECT count(*) FILTER (WHERE workspace_id = %L) || ''/'' || count(*) FILTER (WHERE workspace_id <> %L) FROM public.artist_travel_document_audit', bb_test.id('wa'), bb_test.id('wa'))), total_a || '/0');
  END LOOP;
  PERFORM bb_test.eq('AUD-01 active member of B reads every audit row of B and none of A',
    bb_test.mem('ub', format('SELECT count(*) FILTER (WHERE workspace_id = %L) || ''/'' || count(*) FILTER (WHERE workspace_id <> %L) FROM public.artist_travel_document_audit', bb_test.id('wb'), bb_test.id('wb'))), total_b || '/0');
  PERFORM bb_test.eq('AUD-01 dual member reads exactly the union of both workspaces',
    bb_test.mem('dual', 'SELECT count(*) FROM public.artist_travel_document_audit'), (total_a::int + total_b::int)::text);
  FOREACH who IN ARRAY ARRAY['inactive', 'pending', 'outsider'] LOOP
    PERFORM bb_test.eq('AUD-01 ' || who || ' reads no audit row', bb_test.mem(who, 'SELECT count(*) FROM public.artist_travel_document_audit'), '0');
  END LOOP;
  PERFORM bb_test.eq('AUD-01 no session reads no audit row', bb_test.q('authenticated', NULL, 'SELECT count(*) FROM public.artist_travel_document_audit'), '0');
  -- Removed membership stops reading at once; restored for the rest of the suite.
  UPDATE public.workspace_members SET status = 'inactive' WHERE user_id = bb_test.id('admin');
  PERFORM bb_test.eq('AUD-01 a member made inactive reads nothing', bb_test.mem('admin', 'SELECT count(*) FROM public.artist_travel_document_audit'), '0');
  UPDATE public.workspace_members SET status = 'active' WHERE user_id = bb_test.id('admin');
END
$$;

-- ---------------------------------------------------------------------------------------------
-- CORE-02 / CORE-04 .. CORE-08 / AUD-03 / URL-01 (database side): download authorization.
-- ---------------------------------------------------------------------------------------------
DO $$
DECLARE
  wa uuid := bb_test.id('wa');
  doc uuid := bb_test.card('master', 'wa', 'a1', 'DL-0001');
  file uuid := bb_test.scan('master', 'wa', doc);
  doc2 uuid := bb_test.card('master', 'wa', 'a2', 'DL-0002');
  file2 uuid := bb_test.scan('master', 'wa', doc2);
  docb uuid := bb_test.card('ub', 'wb', 'ab', 'DL-B');
  fileb uuid := bb_test.scan('ub', 'wb', docb);
  r uuid;
  before_rows bigint;
  authorized_row text;
BEGIN
  -- CORE-02: canonical binding, including siblings inside one authorized workspace.
  PERFORM bb_test.eq('CORE-02 file of workspace B through workspace A', bb_test.authorize('master', 'wa', fileb, gen_random_uuid()), 'BB014');
  PERFORM bb_test.eq('CORE-02 dual member: file of A through workspace B', bb_test.authorize('dual', 'wb', file, gen_random_uuid()), 'BB014');
  PERFORM bb_test.eq('CORE-02 unknown file', bb_test.authorize('master', 'wa', gen_random_uuid(), gen_random_uuid()), 'BB014');
  BEGIN
    UPDATE public.artist_travel_documents SET current_file_id = file2 WHERE id = doc;
    PERFORM bb_test.eq('CORE-02 a card cannot point at a sibling card''s scan', 'accepted', '23503');
  EXCEPTION WHEN foreign_key_violation THEN
    PERFORM bb_test.eq('CORE-02 a card cannot point at a sibling card''s scan', SQLSTATE, '23503');
  END;
  BEGIN
    UPDATE public.artist_travel_document_files SET artist_id = bb_test.id('a2') WHERE id = file;
    PERFORM bb_test.eq('CORE-02 a scan cannot be re-bound to another artist', 'accepted', 'refused');
  EXCEPTION WHEN OTHERS THEN
    PERFORM bb_test.eq('CORE-02 a scan cannot be re-bound to another artist', 'refused', 'refused');
  END;
  PERFORM bb_test.eq('CORE-02 allocated key is under workspace/artist/card/version',
    (SELECT (object_key LIKE workspace_id || '/' || artist_id || '/' || document_id || '/' || id || '/%')::text FROM public.artist_travel_document_files WHERE id = file), 'true');

  -- CORE-05: a refused or failing authorization leaves no event and returns nothing.
  SELECT count(*) INTO before_rows FROM public.artist_travel_document_audit;
  PERFORM bb_test.eq('CORE-05 / AUD-03 booking of another artist is not a valid context', bb_test.authorize('member', 'wa', file, gen_random_uuid(), bb_test.id('b2')), 'BB017');
  PERFORM bb_test.eq('CORE-05 / AUD-03 booking of another workspace is not a valid context', bb_test.authorize('member', 'wa', file, gen_random_uuid(), bb_test.id('bb')), 'BB017');
  PERFORM bb_test.eq('CORE-05 / AUD-03 event of another artist is not a valid context', bb_test.authorize('member', 'wa', file, gen_random_uuid(), NULL, bb_test.id('e2')), 'BB017');
  PERFORM bb_test.eq('CORE-05 / AUD-03 unknown booking is not a valid context', bb_test.authorize('member', 'wa', file, gen_random_uuid(), gen_random_uuid()), 'BB017');
  PERFORM bb_test.eq('CORE-03 inactive actor', bb_test.authorize('inactive', 'wa', file, gen_random_uuid()), 'BB013');
  PERFORM bb_test.eq('CORE-03 pending actor', bb_test.authorize('pending', 'wa', file, gen_random_uuid()), 'BB013');
  PERFORM bb_test.eq('CORE-03 actor of another workspace', bb_test.authorize('ub', 'wa', file, gen_random_uuid()), 'BB013');
  PERFORM bb_test.eq('CORE-05 missing request id', bb_test.svc(format('SELECT object_key FROM public.backbeat_travel_document_authorize_download(%L, %L, %L, NULL)', bb_test.id('member'), wa, file)), 'BB015');
  PERFORM bb_test.eq('CORE-05 refused attempts wrote no event',
    (SELECT (count(*) - before_rows)::text FROM public.artist_travel_document_audit), '0');

  -- CORE-04 / CORE-06 / AUD-03: both context variants; one committed event before any signing.
  r := gen_random_uuid();
  PERFORM bb_test.eq('CORE-06 no context: authorized', bb_test.authorize('member', 'wa', file, r), '1');
  PERFORM bb_test.eq('CORE-04 exactly one authorization event exists before the signer is called',
    (SELECT count(*) || '|' || string_agg(action, ',') FROM public.artist_travel_document_audit WHERE request_id = r), '1|download_authorized');
  PERFORM bb_test.eq('AUD-03 trusted actor, exact card and version, database time, no context',
    (SELECT (actor_id = bb_test.id('member') AND document_id = doc AND file_id = file AND workspace_id = wa
        AND artist_id = bb_test.id('a1') AND document_generation = 1 AND booking_id IS NULL AND event_id IS NULL
        AND detail IS NULL AND occurred_at = now())::text
     FROM public.artist_travel_document_audit WHERE request_id = r), 'true');
  SELECT a::text INTO authorized_row FROM public.artist_travel_document_audit a WHERE request_id = r;
  PERFORM bb_test.eq('URL-01 released only after the fence: issued', bb_test.issue('member', 'wa', file, r, 1), 'true');
  PERFORM bb_test.eq('CORE-04 outcome is a second row; the authorization row is unchanged',
    (SELECT string_agg(action, ',' ORDER BY seq) || '|' || bool_or(a::text = authorized_row) FROM public.artist_travel_document_audit a WHERE request_id = r),
    'download_authorized,download_issued|true');
  r := gen_random_uuid();
  PERFORM bb_test.eq('CORE-06 booking context: authorized (colleague who is not the creator)', bb_test.authorize('admin', 'wa', file, r, bb_test.id('b1')), '1');
  PERFORM bb_test.eq('AUD-03 validated booking recorded', (SELECT booking_id::text FROM public.artist_travel_document_audit WHERE request_id = r), bb_test.id('b1')::text);
  r := gen_random_uuid();
  PERFORM bb_test.eq('CORE-06 event context: authorized', bb_test.authorize('dual', 'wa', file, r, NULL, bb_test.id('e1')), '1');
  PERFORM bb_test.eq('AUD-03 validated event recorded', (SELECT event_id::text FROM public.artist_travel_document_audit WHERE request_id = r), bb_test.id('e1')::text);

  -- CORE-07: signer failure is an immutable authorized attempt, never a release; no replay.
  r := gen_random_uuid();
  PERFORM bb_test.authorize('member', 'wa', file, r);
  PERFORM bb_test.eq('CORE-07 signer failed: nothing released', bb_test.issue('member', 'wa', file, r, 1, false), 'false');
  PERFORM bb_test.eq('CORE-07 attempt kept, outcome distinguishes the failure', (bb_test.events(doc) ~ 'download_authorized,download_not_issued:signer_failed$')::text, 'true');
  PERFORM bb_test.eq('CORE-07 a second outcome for the same request is refused', bb_test.issue('member', 'wa', file, r, 1, true), 'BB015');
  PERFORM bb_test.eq('CORE-07 the same request id cannot be authorized again', bb_test.authorize('member', 'wa', file, r), 'BB015');
  PERFORM bb_test.eq('CORE-07 outcome without a matching authorization is refused', bb_test.issue('member', 'wa', file, gen_random_uuid(), 1), 'BB014');
  r := gen_random_uuid();
  PERFORM bb_test.authorize('member', 'wa', file, r);
  PERFORM bb_test.eq('CORE-07 outcome by another actor than the authorized one is refused', bb_test.issue('admin', 'wa', file, r, 1), 'BB014');
  PERFORM bb_test.eq('CORE-07 a fresh request re-authorizes and can be released', bb_test.issue('member', 'wa', file, r, 1), 'true');

  -- CORE-08: an authorization that loses the lifecycle generation releases nothing.
  r := gen_random_uuid();
  PERFORM bb_test.authorize('member', 'wa', file, r);
  PERFORM bb_test.mem('admin', format('SELECT public.backbeat_travel_document_archive(%L, %L)', wa, doc));
  PERFORM bb_test.eq('CORE-08 archive between authorization and release: no link', bb_test.issue('member', 'wa', file, r, 1), 'false');
  PERFORM bb_test.eq('CORE-08 recorded as not issued, lost generation',
    (SELECT action || ':' || detail FROM public.artist_travel_document_audit WHERE request_id = r AND action <> 'download_authorized'), 'download_not_issued:lost_generation');
  PERFORM bb_test.eq('LIFE-01 archived card: no new authorization', bb_test.authorize('member', 'wa', file, gen_random_uuid()), 'BB015');
  -- Replacement between authorization and release (card doc2).
  r := gen_random_uuid();
  PERFORM bb_test.authorize('member', 'wa', file2, r);
  PERFORM bb_test.scan('admin', 'wa', doc2, repeat('b', 64));
  PERFORM bb_test.eq('CORE-08 replacement between authorization and release: no link to the old version', bb_test.issue('member', 'wa', file2, r, 1), 'false');
  PERFORM bb_test.eq('CORE-08 displaced version: no new authorization', bb_test.authorize('member', 'wa', file2, gen_random_uuid()), 'BB015');
  -- Membership removed between authorization and release.
  r := gen_random_uuid();
  PERFORM bb_test.authorize('member', 'wb', fileb, r);
  PERFORM bb_test.eq('CORE-03 actor not in workspace B: refused before any event', (SELECT count(*)::text FROM public.artist_travel_document_audit WHERE request_id = r), '0');
  PERFORM bb_test.authorize('dual', 'wb', fileb, r);
  UPDATE public.workspace_members SET status = 'inactive' WHERE user_id = bb_test.id('dual') AND workspace_id = bb_test.id('wb');
  PERFORM bb_test.eq('CORE-08 / CORE-03 membership removed between authorization and release: no link', bb_test.issue('dual', 'wb', fileb, r, 1), 'false');
  PERFORM bb_test.eq('CORE-03 recorded as membership lost',
    (SELECT detail FROM public.artist_travel_document_audit WHERE request_id = r AND action = 'download_not_issued'), 'membership_lost');
  PERFORM bb_test.eq('CORE-03 removed member: no fresh authorization', bb_test.authorize('dual', 'wb', fileb, gen_random_uuid()), 'BB013');
  UPDATE public.workspace_members SET status = 'active' WHERE user_id = bb_test.id('dual') AND workspace_id = bb_test.id('wb');
  PERFORM bb_test.eq('CORE-08 committed attempts are immutable (superuser UPDATE refused)',
    bb_test.run_as(NULL, format('RESET ROLE; UPDATE public.artist_travel_document_audit SET detail = NULL WHERE document_id = %L', doc)), 'BB012');
END
$$;

-- ---------------------------------------------------------------------------------------------
-- FILE-01 (database side) / LIFE-10 / LIFE-03 (sequential interleavings): scan versions.
-- ---------------------------------------------------------------------------------------------
DO $$
DECLARE
  wa uuid := bb_test.id('wa');
  doc uuid := bb_test.card('member', 'wa', 'a1', 'FILE-0001');
  f1 uuid; f2 uuid; f3 uuid; f4 uuid;
  key1 text;
  objects_before bigint;
  fin text := 'SELECT public.backbeat_travel_document_finalize_upload(%L, %L, %L, %L, %s, %L%s)';
  member uuid := bb_test.id('member');
BEGIN
  f1 := bb_test.svc(format('SELECT file_id FROM public.backbeat_travel_document_reserve_upload(%L, %L, %L)', member, wa, doc))::uuid;
  INSERT INTO storage.objects (bucket_id, name) SELECT 'artist-travel-documents', object_key FROM public.artist_travel_document_files WHERE id = f1;
  PERFORM bb_test.eq('FILE-01 reservation is pending and unservable', bb_test.file_state(f1) || '|' || bb_test.authorize('member', 'wa', f1, gen_random_uuid()), 'pending|BB015');
  PERFORM bb_test.eq('FILE-01 type outside PDF/JPEG/PNG/HEIC refused', bb_test.svc(format(fin, member, wa, f1, 'image/svg+xml', 10, repeat('a', 64), '')), '23514');
  PERFORM bb_test.eq('FILE-01 more than 10 MB refused', bb_test.svc(format(fin, member, wa, f1, 'application/pdf', 10485761, repeat('a', 64), '')), '23514');
  PERFORM bb_test.eq('FILE-01 empty file refused', bb_test.svc(format(fin, member, wa, f1, 'application/pdf', 0, repeat('a', 64), '')), '23514');
  PERFORM bb_test.eq('FILE-01 malformed digest refused', bb_test.svc(format(fin, member, wa, f1, 'application/pdf', 10, 'zz', '')), '23514');
  PERFORM bb_test.eq('FILE-01 refused finalize leaves the reservation pending', bb_test.file_state(f1), 'pending');
  PERFORM bb_test.eq('FILE-01 exactly 10 MB of an approved type is admitted', bb_test.svc(format(fin, member, wa, f1, 'image/heic', 10485760, repeat('c', 64), '')), 'ready');
  PERFORM bb_test.eq('FILE-01 ready with the observed size, digest and immutable key',
    (SELECT (state = 'ready' AND admitted AND byte_size = 10485760 AND sha256 = repeat('c', 64) AND media_type = 'image/heic')::text FROM public.artist_travel_document_files WHERE id = f1), 'true');
  PERFORM bb_test.eq('LIFE-03 retry of a committed finalize is refused, nothing forks', bb_test.svc(format(fin, member, wa, f1, 'image/heic', 10485760, repeat('c', 64), '')), 'BB015');
  SELECT object_key INTO key1 FROM public.artist_travel_document_files WHERE id = f1;

  -- Invalid bytes found by the server: never admitted, current stays.
  f2 := bb_test.svc(format('SELECT file_id FROM public.backbeat_travel_document_reserve_upload(%L, %L, %L)', member, wa, doc))::uuid;
  PERFORM bb_test.eq('FILE-01 server found invalid bytes: rejected', bb_test.svc(format(fin, member, wa, f2, NULL, 'NULL', NULL, ', ''invalid_bytes''')), 'rejected');
  PERFORM bb_test.eq('LIFE-10 a failed replacement preserves the current version',
    (SELECT (current_file_id = f1)::text || '|' || bb_test.file_state(f1) || '|' || bb_test.file_state(f2) FROM public.artist_travel_documents WHERE id = doc), 'true|ready|rejected');
  PERFORM bb_test.eq('FILE-01 rejected version is unservable', bb_test.authorize('member', 'wa', f2, gen_random_uuid()), 'BB015');

  -- LIFE-10: valid replacement.
  SELECT count(*) INTO objects_before FROM storage.objects;
  f3 := bb_test.scan('admin', 'wa', doc, repeat('d', 64));
  PERFORM bb_test.eq('LIFE-10 the validated new version is current',
    (SELECT (current_file_id = f3)::text || '|' || generation FROM public.artist_travel_documents WHERE id = doc), 'true|1');
  PERFORM bb_test.eq('LIFE-10 the displaced version is kept privately with its own 12-month cutoff, key unchanged',
    (SELECT (state = 'superseded' AND object_key = key1 AND sha256 = repeat('c', 64)
       AND restore_until = public.backbeat_travel_document_cutoff(archived_at))::text FROM public.artist_travel_document_files WHERE id = f1), 'true');
  PERFORM bb_test.eq('LIFE-10 no object was removed or overwritten by the replacement',
    (SELECT (count(*) - objects_before)::text || '|' || count(*) FILTER (WHERE name = key1) FROM storage.objects), '1|1');
  PERFORM bb_test.eq('LIFE-10 audit: upload, rejected attempt, replacement',
    bb_test.events(doc), 'card_created,scan_upload_reserved,scan_uploaded,scan_upload_reserved,scan_rejected:invalid_bytes,scan_upload_reserved,scan_replaced');

  -- LIFE-03, archive first: a reservation taken before the archive cannot become ready.
  f4 := bb_test.svc(format('SELECT file_id FROM public.backbeat_travel_document_reserve_upload(%L, %L, %L)', member, wa, doc))::uuid;
  PERFORM bb_test.mem('member', format('SELECT public.backbeat_travel_document_archive(%L, %L)', wa, doc));
  PERFORM bb_test.eq('LIFE-03 archive first: late finalize is rejected', bb_test.svc(format(fin, member, wa, f4, 'application/pdf', 10, repeat('e', 64), '')), 'rejected');
  PERFORM bb_test.eq('LIFE-03 archive first: version unavailable, inventoried, current unchanged',
    (SELECT f.state || ':' || f.reject_reason || '|' || (f.object_key IS NOT NULL) || '|' || (d.current_file_id = f3)
     FROM public.artist_travel_document_files f JOIN public.artist_travel_documents d ON d.id = f.document_id WHERE f.id = f4), 'rejected:lost_generation|true|true');
  PERFORM bb_test.eq('LIFE-03 no new reservation on an archived card', bb_test.svc(format('SELECT file_id FROM public.backbeat_travel_document_reserve_upload(%L, %L, %L)', member, wa, doc)), 'BB015');
  -- Archive, restore, then an older reservation: still the wrong generation.
  PERFORM bb_test.mem('member', format('SELECT public.backbeat_travel_document_restore(%L, %L)', wa, doc));
  PERFORM bb_test.eq('LIFE-03 finalize first: the admitted version went into the archive and came back with the card',
    (SELECT (current_file_id = f3)::text || '|' || bb_test.file_state(f3) FROM public.artist_travel_documents WHERE id = doc), 'true|restore_pending');
  INSERT INTO bb_test.keep VALUES ('file_doc', doc::text), ('file_f1', f1::text), ('file_f2', f2::text), ('file_f3', f3::text), ('file_f4', f4::text);
END
$$;

-- ---------------------------------------------------------------------------------------------
-- LIFE-01 / LIFE-04 / LIFE-06 / LIFE-07 / LIFE-08: archive, restore, expiry, clock.
-- ---------------------------------------------------------------------------------------------
SELECT bb_test.eq('LIFE-08 cutoff: 12 calendar months in UTC, same time of day',
  public.backbeat_travel_document_cutoff('2026-11-27 13:49:41.123456+00')::text, '2027-11-27 13:49:41.123456+00');
SELECT bb_test.eq('LIFE-08 cutoff: 29 February clamps to 28 February',
  public.backbeat_travel_document_cutoff('2028-02-29 23:59:59+00')::text, '2029-02-28 23:59:59+00');
SELECT bb_test.eq('LIFE-08 cutoff: computed in UTC whatever the session zone or input offset',
  public.backbeat_travel_document_cutoff('2027-03-01 08:30:00+10')::text, '2028-02-28 22:30:00+00');
SET TimeZone = 'Pacific/Auckland';
SELECT bb_test.eq('LIFE-08 cutoff: same instant under another session time zone',
  (public.backbeat_travel_document_cutoff('2028-02-29 23:59:59+00') = '2029-02-28 23:59:59+00'::timestamptz)::text, 'true');
SET TimeZone = 'UTC';

DO $$
DECLARE
  wa uuid := bb_test.id('wa');
  doc uuid := bb_test.card('member', 'wa', 'a1', 'LIFE-0001', DATE '2020-01-01');  -- long expired
  file uuid := bb_test.scan('member', 'wa', doc, repeat('f', 64));
  nofile uuid := bb_test.card('member', 'wa', 'a1', 'LIFE-0002');
  objects_before bigint := (SELECT count(*) FROM storage.objects);
  history text := (SELECT md5(string_agg(b::text, '|' ORDER BY id)) FROM public.bookings b);
  cutoff timestamptz;
  archive text := 'SELECT public.backbeat_travel_document_archive(%L, %L)';
  restore text := 'SELECT public.backbeat_travel_document_restore(%L, %L)';
  confirm text := 'SELECT public.backbeat_travel_document_confirm_restored_file(%L, %L, %L, %s, %L)';
BEGIN
  -- LIFE-04: expiry is not a lifecycle event.
  PERFORM bb_test.eq('LIFE-04 an expired document stays an active card with its true expiry date',
    (SELECT state || '|' || expires_on || '|' || (restore_until IS NULL) FROM public.artist_travel_documents WHERE id = doc), 'active|2020-01-01|true');
  PERFORM bb_test.eq('LIFE-04 expiry starts no recovery clock and no purge', bb_test.svc('SELECT public.backbeat_travel_document_purge_claim()') || '|' || bb_test.doc_state(doc), '0|active/1');
  PERFORM bb_test.eq('LIFE-04 an expired document''s scan is still issued while the card is active', bb_test.authorize('member', 'wa', file, gen_random_uuid()), '1');

  -- LIFE-01: recoverable delete.
  PERFORM bb_test.eq('LIFE-01 delete archives the card', bb_test.mem('member', format(archive, wa, doc)), 'archived');
  SELECT restore_until INTO cutoff FROM public.artist_travel_documents WHERE id = doc;
  PERFORM bb_test.eq('LIFE-01 card and scan kept, cutoff = archive time + 12 calendar months, generation moved',
    (SELECT (d.state = 'archived' AND d.number = 'LIFE-0001' AND d.archive_cause = 'deleted' AND d.archived_at = now()
       AND d.restore_until = public.backbeat_travel_document_cutoff(now()) AND d.generation = 2
       AND d.current_file_id = file AND f.state = 'ready' AND f.sha256 = repeat('f', 64))::text
     FROM public.artist_travel_documents d JOIN public.artist_travel_document_files f ON f.id = d.current_file_id WHERE d.id = doc), 'true');
  PERFORM bb_test.eq('LIFE-01 ordinary delivery denied', bb_test.authorize('member', 'wa', file, gen_random_uuid()), 'BB015');
  PERFORM bb_test.eq('LIFE-01 no Storage object removed', (SELECT (count(*) - objects_before)::text FROM storage.objects), '0');
  PERFORM bb_test.eq('LIFE-01 booking history unchanged', (SELECT md5(string_agg(b::text, '|' ORDER BY id)) FROM public.bookings b), history);
  PERFORM bb_test.eq('LIFE-01 repeated delete is a no-op', bb_test.mem('admin', format(archive, wa, doc)), 'already_archived');
  PERFORM bb_test.eq('LIFE-01 repeated delete moved neither cutoff nor generation and wrote no event',
    (SELECT (restore_until = cutoff)::text || '|' || generation FROM public.artist_travel_documents WHERE id = doc) || '|' || bb_test.events(doc),
    'true|2|card_created,scan_upload_reserved,scan_uploaded,download_authorized,archived:deleted');
  PERFORM bb_test.eq('LIFE-01 a read does not move the cutoff', bb_test.mem('member', format('SELECT (restore_until = %L)::text FROM public.artist_travel_documents WHERE id = %L', cutoff, doc)), 'true');

  -- LIFE-08: strict boundary. now() is fixed inside this transaction.
  UPDATE public.artist_travel_documents SET restore_until = now() WHERE id = doc;
  PERFORM bb_test.eq('LIFE-08 restore at the cutoff instant is refused', bb_test.mem('member', format(restore, wa, doc)), 'BB016');
  UPDATE public.artist_travel_documents SET restore_until = now() - INTERVAL '1 microsecond' WHERE id = doc;
  PERFORM bb_test.eq('LIFE-08 restore after the cutoff is refused', bb_test.mem('member', format(restore, wa, doc)), 'BB016');
  UPDATE public.artist_travel_documents SET restore_until = now() + INTERVAL '1 microsecond' WHERE id = doc;
  PERFORM bb_test.eq('LIFE-08 a not-yet-due card is not claimed by the purge', bb_test.svc('SELECT public.backbeat_travel_document_purge_claim()') || '|' || bb_test.doc_state(doc), '0|archived/2');
  PERFORM bb_test.eq('LIFE-08 the expiry date and a client clock play no part: restore strictly before the cutoff wins',
    bb_test.mem('member', format('SET LOCAL TimeZone = ''Pacific/Kiritimati''; ' || restore, wa, doc)), 'restored');

  -- LIFE-07: identity kept, bytes re-verified, expired material restorable.
  PERFORM bb_test.eq('LIFE-07 restored card keeps id, workspace, artist and data; a new episode can start later',
    (SELECT (state = 'active' AND workspace_id = wa AND artist_id = bb_test.id('a1') AND number = 'LIFE-0001'
       AND expires_on = DATE '2020-01-01' AND archived_at IS NULL AND restore_until IS NULL AND generation = 3 AND current_file_id = file)::text
     FROM public.artist_travel_documents WHERE id = doc), 'true');
  PERFORM bb_test.eq('LIFE-07 the scan is not servable until its bytes are verified', bb_test.file_state(file) || '|' || bb_test.authorize('member', 'wa', file, gen_random_uuid()), 'restore_pending|BB020');
  PERFORM bb_test.eq('LIFE-07 repeating the restore changes nothing', bb_test.mem('member', format(restore, wa, doc)) || '|' || bb_test.doc_state(doc), 'already_active|active/3');
  PERFORM bb_test.eq('LIFE-07 exactly one restore event', (SELECT count(*)::text FROM public.artist_travel_document_audit WHERE document_id = doc AND action = 'restored'), '1');
  PERFORM bb_test.eq('LIFE-07 probe returns the key only to the trusted path',
    (bb_test.svc(format('SELECT public.backbeat_travel_document_restore_probe(%L, %L, %L)', bb_test.id('member'), wa, file)) = (SELECT object_key FROM public.artist_travel_document_files WHERE id = file))::text, 'true');
  -- LIFE-06 / LIFE-07: missing or different bytes never become ready.
  PERFORM bb_test.eq('LIFE-06 object absent: missing', bb_test.svc(format(confirm, bb_test.id('member'), wa, file, 'NULL', NULL)), 'missing');
  PERFORM bb_test.eq('LIFE-06 metadata without bytes is unavailable', bb_test.authorize('member', 'wa', file, gen_random_uuid()), 'BB020');
  PERFORM bb_test.eq('LIFE-07 different digest: still missing', bb_test.svc(format(confirm, bb_test.id('member'), wa, file, '1234', repeat('0', 64))), 'missing');
  PERFORM bb_test.eq('LIFE-07 different size: still missing', bb_test.svc(format(confirm, bb_test.id('member'), wa, file, '1235', repeat('f', 64))), 'missing');
  PERFORM bb_test.eq('LIFE-07 exact bytes observed: ready', bb_test.svc(format(confirm, bb_test.id('member'), wa, file, '1234', repeat('f', 64))), 'ready');
  PERFORM bb_test.eq('LIFE-07 verified scan is issued again, with a fresh audit event', bb_test.authorize('member', 'wa', file, gen_random_uuid()), '3');
  PERFORM bb_test.eq('LIFE-07 a ready scan cannot be re-confirmed', bb_test.svc(format(confirm, bb_test.id('member'), wa, file, '1234', repeat('f', 64))), 'BB015');
  PERFORM bb_test.eq('LIFE-07 audit trail of the episode',
    (bb_test.events(doc) ~ 'archived:deleted,restored,scan_restore_missing,scan_restore_verified,download_authorized$')::text, 'true');
  PERFORM bb_test.eq('LIFE-07 a card without a scan restores without any file step',
    bb_test.mem('member', format(archive, wa, nofile)) || '|' || bb_test.mem('member', format(restore, wa, nofile)) || '|' || bb_test.doc_state(nofile), 'archived|restored|active/3');
  INSERT INTO bb_test.keep VALUES ('life_doc', doc::text), ('life_file', file::text);
END
$$;

-- ---------------------------------------------------------------------------------------------
-- LIFE-05: relationship end / resume (manual, per artist).
-- ---------------------------------------------------------------------------------------------
DO $$
DECLARE
  wa uuid := bb_test.id('wa');
  a2 uuid := bb_test.id('a2');
  early uuid := bb_test.card('member', 'wa', 'a2', 'REL-EARLY');
  d1 uuid := bb_test.card('member', 'wa', 'a2', 'REL-0001');
  d2 uuid := bb_test.card('member', 'wa', 'a2', 'REL-0002');
  f1 uuid := bb_test.scan('member', 'wa', d1);
  other_before text;
  early_cutoff timestamptz;
  objects_before bigint;
  fin text := 'SELECT public.backbeat_travel_document_relationship_end(%L, %L)';
  res text := 'SELECT public.backbeat_travel_document_relationship_resume(%L, %L)';
BEGIN
  PERFORM bb_test.mem('member', format('SELECT public.backbeat_travel_document_archive(%L, %L)', wa, early));
  UPDATE public.artist_travel_documents SET archived_at = archived_at - INTERVAL '3 months', restore_until = restore_until - INTERVAL '3 months' WHERE id = early;
  SELECT restore_until INTO early_cutoff FROM public.artist_travel_documents WHERE id = early;
  SELECT md5(string_agg(d::text, '|' ORDER BY id)) INTO other_before FROM public.artist_travel_documents d WHERE artist_id <> a2;
  SELECT count(*) INTO objects_before FROM storage.objects;
  PERFORM bb_test.eq('LIFE-05 end relationship archives every active card of the artist (two new + one from the download block)', bb_test.mem('admin', format(fin, wa, a2)), '3');
  PERFORM bb_test.eq('LIFE-05 both cards archived as relationship_ended with their own new cutoff',
    (SELECT string_agg(state || ':' || archive_cause || ':' || (restore_until = public.backbeat_travel_document_cutoff(now())), ',' ORDER BY number)
     FROM public.artist_travel_documents WHERE id IN (d1, d2)), 'archived:relationship_ended:true,archived:relationship_ended:true');
  PERFORM bb_test.eq('LIFE-05 a card archived earlier keeps its original cutoff and cause',
    (SELECT (restore_until = early_cutoff)::text || '|' || archive_cause || '|' || generation FROM public.artist_travel_documents WHERE id = early), 'true|deleted|2');
  PERFORM bb_test.eq('LIFE-05 cards of other artists and workspaces untouched',
    (SELECT md5(string_agg(d::text, '|' ORDER BY id)) FROM public.artist_travel_documents d WHERE artist_id <> a2), other_before);
  PERFORM bb_test.eq('LIFE-05 no Storage object removed; artist and bookings kept',
    (SELECT (count(*) - objects_before)::text FROM storage.objects) || '|' || (SELECT count(*) FROM public.artists WHERE id = a2) || '|' || (SELECT count(*) FROM public.bookings WHERE artist_id = a2), '0|1|1');
  PERFORM bb_test.eq('LIFE-05 scans of the ended artist are not issued', bb_test.authorize('member', 'wa', f1, gen_random_uuid()), 'BB015');
  PERFORM bb_test.eq('LIFE-05 repeating end is a no-op (no cutoff moves)', bb_test.mem('member', format(fin, wa, a2)), '0');
  PERFORM bb_test.eq('LIFE-05 while ended: restore refused', bb_test.mem('member', format('SELECT public.backbeat_travel_document_restore(%L, %L)', wa, d1)), 'BB019');
  PERFORM bb_test.eq('LIFE-05 while ended: no new card', bb_test.mem('member', format(
    'INSERT INTO public.artist_travel_documents (workspace_id, artist_id, doc_type, number) VALUES (%L, %L, ''passport'', ''REL-NEW'') RETURNING id', wa, a2)), 'BB019');
  PERFORM bb_test.eq('LIFE-05 resume re-enables, restores nothing by itself',
    bb_test.mem('master', format(res, wa, a2)) || '|' || (SELECT count(*) FROM public.artist_travel_documents WHERE artist_id = a2 AND state = 'active'), 'true|0');
  PERFORM bb_test.eq('LIFE-05 resume twice is a no-op', bb_test.mem('master', format(res, wa, a2)), 'false');
  PERFORM bb_test.eq('LIFE-05 renewal is a distinct per-card restore inside its window',
    bb_test.mem('member', format('SELECT public.backbeat_travel_document_restore(%L, %L)', wa, d1)) || '|' || bb_test.doc_state(d1) || '|' || bb_test.doc_state(d2), 'restored|active/3|archived/2');
  PERFORM bb_test.eq('LIFE-05 audit: one end and one resume event with the acting members',
    (SELECT string_agg(action || ':' || (actor_id = bb_test.id(CASE action WHEN 'relationship_ended' THEN 'admin' ELSE 'master' END)), ',' ORDER BY seq)
     FROM public.artist_travel_document_audit WHERE artist_id = a2 AND document_id IS NULL), 'relationship_ended:true,relationship_resumed:true');
  PERFORM bb_test.eq('LIFE-05 a booking cancellation is not a relationship signal',
    bb_test.mem('member', format('UPDATE public.bookings SET status = ''cancelled'' WHERE id = %L RETURNING (SELECT count(*) FROM public.artist_travel_documents WHERE artist_id = %L AND state = ''active'')', bb_test.id('b2'), a2)), '1');
  INSERT INTO bb_test.keep VALUES ('rel_d1', d1::text), ('rel_d2', d2::text), ('rel_f1', f1::text), ('rel_early', early::text);
END
$$;

-- ---------------------------------------------------------------------------------------------
-- BB018: no direct or cascaded hard delete, even for the table owner.
-- ---------------------------------------------------------------------------------------------
SELECT bb_test.eq('LIFE-01 superuser DELETE of a card is refused', bb_test.run_as(NULL, 'RESET ROLE; DELETE FROM public.artist_travel_documents'), 'BB018');
SELECT bb_test.eq('LIFE-01 superuser DELETE of a scan row is refused', bb_test.run_as(NULL, 'RESET ROLE; DELETE FROM public.artist_travel_document_files'), 'BB018');
SELECT bb_test.eq('LIFE-01 member artist delete cannot cascade into cards', bb_test.mem('member', format('DELETE FROM public.artists WHERE id = %L RETURNING id', bb_test.id('a1'))), 'BB018');
SELECT bb_test.eq('LIFE-01 workspace delete cannot cascade into cards', bb_test.run_as(NULL, format('RESET ROLE; DELETE FROM public.workspaces WHERE id = %L', bb_test.id('wa'))), 'BB018');

-- ---------------------------------------------------------------------------------------------
-- LIFE-03 / LIFE-09: races, with a real second session and a lock barrier (dblink).
-- "main" holds the card row lock in an open transaction; "other" must block, and is decided
-- only after main commits.
-- ---------------------------------------------------------------------------------------------
-- (a) archive holds the lock, finalize waits -> archive wins, the version never becomes ready.
INSERT INTO bb_test.keep SELECT 'race_a_doc', bb_test.card('member', 'wa', 'a1', 'RACE-A')::text;
INSERT INTO bb_test.keep SELECT 'race_a_file', bb_test.svc(format('SELECT file_id FROM public.backbeat_travel_document_reserve_upload(%L, %L, %L)',
  bb_test.id('member'), bb_test.id('wa'), (SELECT v FROM bb_test.keep WHERE k = 'race_a_doc')));
BEGIN;
SELECT bb_test.eq('LIFE-03 barrier a: archive runs first (uncommitted)',
  bb_test.mem('member', format('SELECT public.backbeat_travel_document_archive(%L, %L)', bb_test.id('wa'), (SELECT v FROM bb_test.keep WHERE k = 'race_a_doc'))), 'archived');
SELECT dblink_send_query('other', format($q$SELECT bb_test.svc(format('SELECT public.backbeat_travel_document_finalize_upload(%%L, %%L, %%L, ''application/pdf'', 10, %%L)', %L::uuid, %L::uuid, %L::uuid, repeat('a', 64)))$q$,
  bb_test.id('member'), bb_test.id('wa'), (SELECT v FROM bb_test.keep WHERE k = 'race_a_file')));
SELECT bb_test.eq('LIFE-03 barrier a: finalize is blocked behind the archive', bb_test.wait_blocked(), 'blocked');
COMMIT;
SELECT bb_test.eq('LIFE-03 barrier a: archive won, the pending version is rejected', bb_test.other_result(), 'rejected');
SELECT bb_test.eq('LIFE-03 barrier a: card archived without a scan; version inventoried as lost_generation',
  (SELECT d.state || '|' || (d.current_file_id IS NULL) || '|' || f.state || ':' || f.reject_reason
   FROM public.artist_travel_documents d, public.artist_travel_document_files f
   WHERE d.id = (SELECT v::uuid FROM bb_test.keep WHERE k = 'race_a_doc') AND f.id = (SELECT v::uuid FROM bb_test.keep WHERE k = 'race_a_file')),
  'archived|true|rejected:lost_generation');

-- (b) finalize holds the lock, archive waits -> finalize wins, the archive includes the new version.
INSERT INTO bb_test.keep SELECT 'race_b_doc', bb_test.card('member', 'wa', 'a1', 'RACE-B')::text;
INSERT INTO bb_test.keep SELECT 'race_b_file', bb_test.svc(format('SELECT file_id FROM public.backbeat_travel_document_reserve_upload(%L, %L, %L)',
  bb_test.id('member'), bb_test.id('wa'), (SELECT v FROM bb_test.keep WHERE k = 'race_b_doc')));
BEGIN;
SELECT bb_test.eq('LIFE-03 barrier b: finalize runs first (uncommitted)',
  bb_test.svc(format('SELECT public.backbeat_travel_document_finalize_upload(%L, %L, %L, ''application/pdf'', 10, %L)',
    bb_test.id('member'), bb_test.id('wa'), (SELECT v FROM bb_test.keep WHERE k = 'race_b_file'), repeat('a', 64))), 'ready');
SELECT dblink_send_query('other', format($q$SELECT bb_test.mem('member', format('SELECT public.backbeat_travel_document_archive(%%L, %%L)', %L::uuid, %L::uuid))$q$,
  bb_test.id('wa'), (SELECT v FROM bb_test.keep WHERE k = 'race_b_doc')));
SELECT bb_test.eq('LIFE-03 barrier b: archive is blocked behind the finalize', bb_test.wait_blocked(), 'blocked');
COMMIT;
SELECT bb_test.eq('LIFE-03 barrier b: archive then succeeds', bb_test.other_result(), 'archived');
SELECT bb_test.eq('LIFE-03 barrier b: the newly admitted version is inside the archive, not servable',
  (SELECT d.state || '|' || (d.current_file_id = f.id) || '|' || f.state || '|' || bb_test.authorize('member', 'wa', f.id, gen_random_uuid())
   FROM public.artist_travel_documents d, public.artist_travel_document_files f
   WHERE d.id = (SELECT v::uuid FROM bb_test.keep WHERE k = 'race_b_doc') AND f.id = (SELECT v::uuid FROM bb_test.keep WHERE k = 'race_b_file')),
  'archived|true|ready|BB015');

-- (c) download authorization vs archive: the fence call waits for the archive and then refuses.
INSERT INTO bb_test.keep SELECT 'race_c_doc', bb_test.card('member', 'wa', 'a1', 'RACE-C')::text;
INSERT INTO bb_test.keep SELECT 'race_c_file', bb_test.scan('member', 'wa', (SELECT v::uuid FROM bb_test.keep WHERE k = 'race_c_doc'))::text;
INSERT INTO bb_test.keep SELECT 'race_c_req', gen_random_uuid()::text;
SELECT bb_test.eq('CORE-08 barrier c: authorized and committed before the archive starts',
  bb_test.authorize('member', 'wa', (SELECT v::uuid FROM bb_test.keep WHERE k = 'race_c_file'), (SELECT v::uuid FROM bb_test.keep WHERE k = 'race_c_req')), '1');
BEGIN;
SELECT bb_test.mem('member', format('SELECT public.backbeat_travel_document_archive(%L, %L)', bb_test.id('wa'), (SELECT v FROM bb_test.keep WHERE k = 'race_c_doc')));
SELECT dblink_send_query('other', format($q$SELECT bb_test.issue('member', 'wa', %L::uuid, %L::uuid, 1, true)$q$,
  (SELECT v FROM bb_test.keep WHERE k = 'race_c_file'), (SELECT v FROM bb_test.keep WHERE k = 'race_c_req')));
SELECT bb_test.eq('CORE-08 barrier c: the release fence is blocked behind the archive', bb_test.wait_blocked(), 'blocked');
COMMIT;
SELECT bb_test.eq('CORE-08 barrier c: the request that lost to the archive releases no link', bb_test.other_result(), 'false');
-- Other interleaving: the fence commits first, the archive after it; the link was an old capability.
INSERT INTO bb_test.keep SELECT 'race_d_doc', bb_test.card('member', 'wa', 'a1', 'RACE-D')::text;
INSERT INTO bb_test.keep SELECT 'race_d_file', bb_test.scan('member', 'wa', (SELECT v::uuid FROM bb_test.keep WHERE k = 'race_d_doc'))::text;
INSERT INTO bb_test.keep SELECT 'race_d_req', gen_random_uuid()::text;
SELECT bb_test.authorize('member', 'wa', (SELECT v::uuid FROM bb_test.keep WHERE k = 'race_d_file'), (SELECT v::uuid FROM bb_test.keep WHERE k = 'race_d_req'));
BEGIN;
SELECT bb_test.eq('CORE-08 barrier d: fence passes first (uncommitted, holds a share lock)',
  bb_test.issue('member', 'wa', (SELECT v::uuid FROM bb_test.keep WHERE k = 'race_d_file'), (SELECT v::uuid FROM bb_test.keep WHERE k = 'race_d_req'), 1, true), 'true');
SELECT dblink_send_query('other', format($q$SELECT bb_test.mem('member', format('SELECT public.backbeat_travel_document_archive(%%L, %%L)', %L::uuid, %L::uuid))$q$,
  bb_test.id('wa'), (SELECT v FROM bb_test.keep WHERE k = 'race_d_doc')));
SELECT bb_test.eq('CORE-08 barrier d: the archive waits for the release decision', bb_test.wait_blocked(), 'blocked');
COMMIT;
SELECT bb_test.eq('CORE-08 barrier d: archive proceeds afterwards; later requests get nothing',
  bb_test.other_result() || '|' || bb_test.authorize('member', 'wa', (SELECT v::uuid FROM bb_test.keep WHERE k = 'race_d_file'), gen_random_uuid()), 'archived|BB015');

-- (e) purge claim holds the lock, restore waits -> the claim blocks the restore for good.
UPDATE public.artist_travel_documents SET restore_until = now() - INTERVAL '1 second'
  WHERE id = (SELECT v::uuid FROM bb_test.keep WHERE k = 'race_b_doc');
BEGIN;
SELECT bb_test.eq('LIFE-09 barrier e: purge claims the due card and its admitted object (uncommitted)',
  bb_test.svc('SELECT public.backbeat_travel_document_purge_claim()'), '1');
SELECT dblink_send_query('other', format($q$SELECT bb_test.mem('member', format('SELECT public.backbeat_travel_document_restore(%%L, %%L)', %L::uuid, %L::uuid))$q$,
  bb_test.id('wa'), (SELECT v FROM bb_test.keep WHERE k = 'race_b_doc')));
SELECT bb_test.eq('LIFE-09 barrier e: restore is blocked behind the claim', bb_test.wait_blocked(), 'blocked');
COMMIT;
SELECT bb_test.eq('LIFE-09 barrier e: the claim won; restore is refused', bb_test.other_result(), 'BB016');
SELECT bb_test.eq('LIFE-09 barrier e: card and object are purge_pending, not restorable, not servable',
  bb_test.doc_state((SELECT v::uuid FROM bb_test.keep WHERE k = 'race_b_doc')) || '|' || bb_test.file_state((SELECT v::uuid FROM bb_test.keep WHERE k = 'race_b_file'))
  || '|' || bb_test.mem('admin', format('SELECT public.backbeat_travel_document_restore(%L, %L)', bb_test.id('wa'), (SELECT v FROM bb_test.keep WHERE k = 'race_b_doc'))),
  'purge_pending/3|purge_pending|BB016');

-- (f) restore holds the lock before the cutoff; the cutoff passes; the purge claim waits ->
-- restore wins and the claim, re-checking the row after the lock, takes nothing.
UPDATE public.artist_travel_documents SET restore_until = clock_timestamp() + INTERVAL '1.5 seconds'
  WHERE id = (SELECT v::uuid FROM bb_test.keep WHERE k = 'race_d_doc');
BEGIN;
SELECT bb_test.eq('LIFE-09 barrier f: restore runs strictly before the cutoff (uncommitted)',
  bb_test.mem('member', format('SELECT public.backbeat_travel_document_restore(%L, %L)', bb_test.id('wa'), (SELECT v FROM bb_test.keep WHERE k = 'race_d_doc'))), 'restored');
SELECT pg_sleep(1.7);
SELECT dblink_send_query('other', $q$SELECT bb_test.svc('SELECT public.backbeat_travel_document_purge_claim()')$q$);
SELECT bb_test.eq('LIFE-09 barrier f: after the cutoff the claim sees a due card and is blocked behind the restore', bb_test.wait_blocked(), 'blocked');
COMMIT;
SELECT bb_test.eq('LIFE-09 barrier f: the restore won; the claim took no object', bb_test.other_result(), '0');
SELECT bb_test.eq('LIFE-09 barrier f: restored card is active and its bytes are outside any workset',
  bb_test.doc_state((SELECT v::uuid FROM bb_test.keep WHERE k = 'race_d_doc')) || '|' || bb_test.file_state((SELECT v::uuid FROM bb_test.keep WHERE k = 'race_d_file')), 'active/3|restore_pending');
SELECT bb_test.eq('LIFE-09 a stale workset entry cannot remove restored bytes: confirm refused',
  bb_test.svc(format('SELECT public.backbeat_travel_document_purge_confirm(%L, ''artist-travel-documents'')', (SELECT v FROM bb_test.keep WHERE k = 'race_d_file'))), 'BB015');
SELECT dblink_disconnect('other');

-- ---------------------------------------------------------------------------------------------
-- LIFE-02 / LIFE-09 / AUD-04: purge workset, partial failure, scrub; audit retention.
-- ---------------------------------------------------------------------------------------------
DO $$
DECLARE
  wa uuid := bb_test.id('wa');
  doc uuid := (SELECT v::uuid FROM bb_test.keep WHERE k = 'file_doc');   -- active, f3 current, f1 superseded, f2/f4 rejected
  f1 uuid := (SELECT v::uuid FROM bb_test.keep WHERE k = 'file_f1');
  f2 uuid := (SELECT v::uuid FROM bb_test.keep WHERE k = 'file_f2');
  f3 uuid := (SELECT v::uuid FROM bb_test.keep WHERE k = 'file_f3');
  f4 uuid := (SELECT v::uuid FROM bb_test.keep WHERE k = 'file_f4');
  raceb uuid := (SELECT v::uuid FROM bb_test.keep WHERE k = 'race_b_doc');
  racebf uuid := (SELECT v::uuid FROM bb_test.keep WHERE k = 'race_b_file');
  not_due uuid := (SELECT v::uuid FROM bb_test.keep WHERE k = 'rel_d2');   -- archived, cutoff in 12 months
  keep_state text;
  audit_before text;
  audit_last bigint;
  sup uuid;
  sup_doc text;
  history text := (SELECT md5(string_agg(b::text, '|' ORDER BY id)) FROM public.bookings b);
  confirm text := 'SELECT public.backbeat_travel_document_purge_confirm(%L, ''artist-travel-documents'')';
  claimed text;
BEGIN
  INSERT INTO storage.objects (bucket_id, name) SELECT 'artist-travel-documents', object_key FROM public.artist_travel_document_files
    WHERE id IN (f1, f2, f4) ON CONFLICT DO NOTHING;
  -- Make the card due (as if 12 months had passed) with a verified current scan.
  PERFORM bb_test.svc(format('SELECT public.backbeat_travel_document_confirm_restored_file(%L, %L, %L, 1234, %L)', bb_test.id('member'), wa, f3, repeat('d', 64)));
  PERFORM bb_test.mem('member', format('SELECT public.backbeat_travel_document_archive(%L, %L)', wa, doc));
  UPDATE public.artist_travel_documents SET archived_at = now() - INTERVAL '13 months', restore_until = public.backbeat_travel_document_cutoff(now() - INTERVAL '13 months') WHERE id = doc;
  SELECT md5(string_agg(d::text || coalesce((SELECT string_agg(f::text, ';' ORDER BY f.id) FROM public.artist_travel_document_files f WHERE f.document_id = d.id), ''), '|' ORDER BY d.id))
    INTO keep_state FROM public.artist_travel_documents d WHERE d.id NOT IN (doc, raceb);
  SELECT md5(string_agg(a::text, '|' ORDER BY seq)), max(seq) INTO audit_before, audit_last FROM public.artist_travel_document_audit a;

  PERFORM bb_test.eq('LIFE-02 dry-run counts: one due card with two admitted objects, one object already claimed, never-admitted counted apart',
    bb_test.svc('SELECT due_documents || ''/'' || due_objects || ''/'' || claimed_objects || ''/'' || (never_admitted >= 2) FROM public.backbeat_travel_document_purge_due()'), '1/2/1/true');
  PERFORM bb_test.eq('ACL-02 dry-run counts are not callable from a session', bb_test.mem('master', 'SELECT due_documents FROM public.backbeat_travel_document_purge_due()'), '42501');
  claimed := bb_test.svc('SELECT public.backbeat_travel_document_purge_claim()');
  PERFORM bb_test.eq('LIFE-02 claim takes the due card''s admitted objects only (current + superseded)', claimed, '2');
  PERFORM bb_test.eq('LIFE-02 workset = exactly the claimed keys (never-admitted and not-due excluded)',
    bb_test.svc('SELECT string_agg(file_id::text, '','' ORDER BY file_id) FROM public.backbeat_travel_document_purge_worklist()'),
    (SELECT string_agg(x::text, ',' ORDER BY x) FROM unnest(ARRAY[f1, f3, racebf]) x));
  PERFORM bb_test.eq('LIFE-02 never-admitted versions stay quarantined, distinct from the purge',
    bb_test.file_state(f2) || '|' || bb_test.file_state(f4), 'rejected|rejected');
  PERFORM bb_test.eq('LIFE-02 not-due and active cards and their objects unchanged',
    (SELECT md5(string_agg(d::text || coalesce((SELECT string_agg(f::text, ';' ORDER BY f.id) FROM public.artist_travel_document_files f WHERE f.document_id = d.id), ''), '|' ORDER BY d.id))
     FROM public.artist_travel_documents d WHERE d.id NOT IN (doc, raceb)), keep_state);
  PERFORM bb_test.eq('LIFE-02 a claimed card is no longer readable by a member session; an archived one inside its window is',
    bb_test.mem('member', format('SELECT count(*) FILTER (WHERE id = %L) || ''/'' || count(*) FILTER (WHERE id = %L) FROM public.artist_travel_documents', doc, not_due)), '0/1');
  PERFORM bb_test.eq('LIFE-02 claimed card keeps its data until every object is confirmed absent',
    (SELECT state || '|' || number FROM public.artist_travel_documents WHERE id = doc), 'purge_pending|FILE-0001');
  PERFORM bb_test.eq('LIFE-02 a second claim (retry, new process) is idempotent', bb_test.svc('SELECT public.backbeat_travel_document_purge_claim()'), '0');

  -- The script removes through the Storage API; the database only believes an absent key.
  PERFORM bb_test.eq('LIFE-02 confirm refused while the object is still listed', bb_test.svc(format(confirm, f3)), 'BB015');
  DELETE FROM storage.objects WHERE name = (SELECT object_key FROM public.artist_travel_document_files WHERE id = f3);
  PERFORM bb_test.eq('LIFE-02 first object confirmed absent', bb_test.svc(format(confirm, f3)), 'purged');
  PERFORM bb_test.eq('LIFE-02 partial removal: card stays purge_pending, other object still claimed with its key',
    (SELECT d.state || '|' || d.number || '|' || f.state || '|' || (f.object_key IS NOT NULL) FROM public.artist_travel_documents d, public.artist_travel_document_files f WHERE d.id = doc AND f.id = f1),
    'purge_pending|FILE-0001|purge_pending|true');
  PERFORM bb_test.eq('LIFE-02 partial state is not servable and not restorable',
    bb_test.authorize('member', 'wa', f1, gen_random_uuid()) || '|' || bb_test.mem('member', format('SELECT public.backbeat_travel_document_restore(%L, %L)', wa, doc)), 'BB015|BB016');
  PERFORM bb_test.eq('LIFE-02 confirm cannot be repeated for a purged object', bb_test.svc(format(confirm, f3)), 'BB015');
  PERFORM bb_test.eq('LIFE-02 an unclaimed object cannot be confirmed', bb_test.svc(format(confirm, (SELECT v FROM bb_test.keep WHERE k = 'life_file'))), 'BB015');
  DELETE FROM storage.objects WHERE name = (SELECT object_key FROM public.artist_travel_document_files WHERE id = f1);
  PERFORM bb_test.eq('LIFE-02 last object confirmed absent', bb_test.svc(format(confirm, f1)), 'purged');
  PERFORM bb_test.eq('LIFE-02 card scrubbed: every document field gone, ids and times kept',
    (SELECT (state = 'purged' AND doc_type IS NULL AND number IS NULL AND issuing_country IS NULL AND nationality IS NULL AND issued_on IS NULL
       AND expires_on IS NULL AND holder_name IS NULL AND current_file_id IS NULL AND purged_at IS NOT NULL AND id = doc AND artist_id = bb_test.id('a1'))::text
     FROM public.artist_travel_documents WHERE id = doc), 'true');
  PERFORM bb_test.eq('LIFE-02 purged scan rows keep the key inventory, drop size and digest',
    (SELECT string_agg(state || ':' || (object_key IS NOT NULL) || ':' || (sha256 IS NULL AND byte_size IS NULL), ',') FROM public.artist_travel_document_files WHERE id IN (f1, f3)), 'purged:true:true,purged:true:true');
  PERFORM bb_test.eq('LIFE-02 objects of other cards still in the bucket; only the two claimed keys are gone',
    (SELECT count(*)::text FROM public.artist_travel_document_files f WHERE f.state IN ('ready', 'restore_pending', 'superseded', 'missing')
       AND NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.name = f.object_key)), '0');
  PERFORM bb_test.eq('LIFE-02 earlier audit rows byte-identical; purge appended its own events without an actor',
    (SELECT (md5(string_agg(a::text, '|' ORDER BY seq)) = audit_before)::text FROM public.artist_travel_document_audit a WHERE seq <= audit_last)
    || '|' || (SELECT string_agg(action, ',' ORDER BY seq) FROM public.artist_travel_document_audit WHERE document_id = doc AND actor_id IS NULL),
    'true|purge_claimed,file_purged,file_purged,document_purged');
  PERFORM bb_test.eq('LIFE-02 booking history unchanged', (SELECT md5(string_agg(b::text, '|' ORDER BY id)) FROM public.bookings b), history);
  PERFORM bb_test.eq('LIFE-02 a purged card is gone for members: not archivable, not restorable',
    bb_test.mem('member', format('SELECT public.backbeat_travel_document_archive(%L, %L)', wa, doc)) || '|' || bb_test.mem('member', format('SELECT public.backbeat_travel_document_restore(%L, %L)', wa, doc)), 'BB014|BB014');
  PERFORM bb_test.eq('LIFE-08 not-due card still restorable after the purge run', bb_test.doc_state(not_due), 'archived/2');

  -- A displaced version past its own cutoff is purged on its own; its card is not touched.
  SELECT f.id, d::text INTO sup, sup_doc FROM public.artist_travel_document_files f
    JOIN public.artist_travel_documents d ON d.id = f.document_id WHERE f.state = 'superseded' LIMIT 1;
  PERFORM bb_test.eq('LIFE-10 a displaced version inside its window is not claimed', bb_test.svc('SELECT public.backbeat_travel_document_purge_claim()') || '|' || bb_test.file_state(sup), '0|superseded');
  UPDATE public.artist_travel_document_files SET archived_at = now() - INTERVAL '13 months',
    restore_until = public.backbeat_travel_document_cutoff(now() - INTERVAL '13 months') WHERE id = sup;
  PERFORM bb_test.eq('LIFE-10 a displaced version past its own cutoff is claimed alone', bb_test.svc('SELECT public.backbeat_travel_document_purge_claim()') || '|' || bb_test.file_state(sup), '1|purge_pending');
  DELETE FROM storage.objects WHERE name = (SELECT object_key FROM public.artist_travel_document_files WHERE id = sup);
  PERFORM bb_test.eq('LIFE-10 displaced version purged; its card and current version unchanged',
    bb_test.svc(format(confirm, sup)) || '|' || (SELECT (d::text = sup_doc)::text FROM public.artist_travel_documents d
      JOIN public.artist_travel_document_files f ON f.document_id = d.id WHERE f.id = sup), 'purged|true');
  -- Quarantine cleanup is a separate claim.
  PERFORM bb_test.eq('LIFE-03 quarantine cleanup needs a minimum age longer than an upload link lives', bb_test.svc('SELECT public.backbeat_travel_document_cleanup_claim(interval ''2 hours'')'), 'BB015');
  PERFORM bb_test.eq('LIFE-03 a fresh reservation, rejected or pending, is not cleaned (its upload link may still deliver bytes)',
    bb_test.svc('SELECT public.backbeat_travel_document_cleanup_claim(interval ''3 hours'')') || '|' || bb_test.file_state(f2) || '|' || bb_test.file_state(f4), '0|rejected|rejected');
  UPDATE public.artist_travel_document_files SET reserved_at = now() - INTERVAL '25 hours' WHERE id IN (f2, f4);
  PERFORM bb_test.eq('LIFE-03 quarantine cleanup claims old never-admitted keys only',
    bb_test.svc('SELECT public.backbeat_travel_document_cleanup_claim(interval ''24 hours'')') || '|' || bb_test.file_state(f2) || '|' || bb_test.file_state(f4), '2|cleanup_pending|cleanup_pending');
  DELETE FROM storage.objects WHERE name IN (SELECT object_key FROM public.artist_travel_document_files WHERE id IN (f2, f4));
  PERFORM bb_test.eq('LIFE-03 quarantined key confirmed absent', bb_test.svc(format(confirm, f2)) || '|' || bb_test.svc(format(confirm, f4)), 'cleaned|cleaned');
  -- A purged tombstone no longer blocks its artist; a live card still does (checked above).
  PERFORM bb_test.eq('LIFE-02 purged tombstone and its purged / cleaned rows can go with a superuser cleanup',
    bb_test.run_as(NULL, format('RESET ROLE; DELETE FROM public.artist_travel_documents WHERE id = %L', doc)), 'OK:1');
END
$$;

DO $$
DECLARE
  rows_before bigint;
  kept text;
  old_id uuid;
BEGIN
  -- AUD-04: append-only for everyone; retention is a separate, bounded operator action.
  PERFORM bb_test.eq('AUD-04 superuser UPDATE refused', bb_test.run_as(NULL, 'RESET ROLE; UPDATE public.artist_travel_document_audit SET detail = NULL'), 'BB012');
  PERFORM bb_test.eq('AUD-04 superuser DELETE refused', bb_test.run_as(NULL, 'RESET ROLE; DELETE FROM public.artist_travel_document_audit'), 'BB012');
  PERFORM bb_test.eq('AUD-04 superuser TRUNCATE refused', bb_test.run_as(NULL, 'RESET ROLE; TRUNCATE public.artist_travel_document_audit'), 'BB012');
  PERFORM bb_test.eq('AUD-04 the retention marker alone does not open the table to a session',
    bb_test.mem('master', 'SET LOCAL backbeat.travel_audit_retention = ''purge''; DELETE FROM public.artist_travel_document_audit RETURNING id'), '42501');
  -- Age two rows of workspace B to 25 months (fixture only: trigger bypassed by the cluster owner).
  SET LOCAL session_replication_role = replica;
  UPDATE public.artist_travel_document_audit SET occurred_at = now() - INTERVAL '25 months'
    WHERE id IN (SELECT id FROM public.artist_travel_document_audit WHERE workspace_id = bb_test.id('wb') ORDER BY seq LIMIT 2);
  SET LOCAL session_replication_role = origin;
  SELECT count(*) INTO rows_before FROM public.artist_travel_document_audit;
  SELECT md5(string_agg(a::text, '|' ORDER BY seq)) INTO kept FROM public.artist_travel_document_audit a WHERE occurred_at >= now() - INTERVAL '24 months';
  PERFORM bb_test.eq('AUD-04 no default purge: old rows are still there', (SELECT count(*)::text FROM public.artist_travel_document_audit WHERE occurred_at < now() - INTERVAL '24 months'), '2');
  PERFORM bb_test.eq('AUD-04 retention cutoff younger than 24 months refused', bb_test.svc('SELECT public.backbeat_travel_document_audit_retention_purge(now() - interval ''23 months'')'), 'BB021');
  PERFORM bb_test.eq('AUD-04 retention cutoff "now" refused', bb_test.svc('SELECT public.backbeat_travel_document_audit_retention_purge(now())'), 'BB021');
  PERFORM bb_test.eq('AUD-04 missing cutoff refused', bb_test.svc('SELECT public.backbeat_travel_document_audit_retention_purge(NULL)'), 'BB021');
  PERFORM bb_test.eq('AUD-04 operator purge removes only the due rows', bb_test.svc('SELECT public.backbeat_travel_document_audit_retention_purge(now() - interval ''24 months'')'), '2');
  PERFORM bb_test.eq('AUD-04 every remaining row exactly unchanged',
    (SELECT count(*) || '|' || (md5(string_agg(a::text, '|' ORDER BY seq)) = kept) FROM public.artist_travel_document_audit a), (rows_before - 2) || '|true');
  PERFORM bb_test.eq('AUD-04 the purge did not leave the table open', bb_test.run_as(NULL, 'RESET ROLE; DELETE FROM public.artist_travel_document_audit'), 'BB012');
  PERFORM bb_test.eq('AUD-04 normal trusted path still cannot mutate', bb_test.svc('DELETE FROM public.artist_travel_document_audit RETURNING id'), '42501');
END
$$;

-- ---------------------------------------------------------------------------------------------
-- storage-provision.sql against the stand-in catalog: guard, private bucket, deny-all policy.
-- ---------------------------------------------------------------------------------------------
\set ON_ERROR_STOP off
\o /dev/null
\ir ../../ops/supabase/booking-travel/storage-provision.sql
SET backbeat.travel_storage_target = 'hosted:hupkygptbvnzrihrlcxv';
\ir ../../ops/supabase/booking-travel/storage-provision.sql
\o
\set ON_ERROR_STOP on
SELECT bb_test.eq('HOST-01 (local shape) provisioning refused without the exact target of this database',
  (SELECT count(*)::text FROM storage.buckets), '0');
SET backbeat.travel_storage_target = 'development';
\o /dev/null
\ir ../../ops/supabase/booking-travel/storage-provision.sql
\ir ../../ops/supabase/booking-travel/storage-provision.sql
\o
SELECT bb_test.eq('HOST-01 (local shape) bucket is private, 10 MB, four types',
  (SELECT public || '|' || file_size_limit || '|' || array_to_string(allowed_mime_types, ',') FROM storage.buckets WHERE id = 'artist-travel-documents'),
  'false|10485760|application/pdf,image/jpeg,image/png,image/heic');
CREATE POLICY bb_test_broad ON storage.objects FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
SELECT bb_test.eq('HOST-01 (local shape) member session lists no object of the bucket even under a broad permissive policy',
  bb_test.mem('master', 'SELECT count(*) FROM storage.objects WHERE bucket_id = ''artist-travel-documents'''), '0');
SELECT bb_test.eq('HOST-01 (local shape) member session cannot create an object in the bucket',
  bb_test.mem('master', 'INSERT INTO storage.objects (bucket_id, name) VALUES (''artist-travel-documents'', ''x'') RETURNING name'), '42501');
SELECT bb_test.eq('HOST-01 (local shape) member session cannot overwrite or remove an object of the bucket',
  bb_test.mem('master', 'UPDATE storage.objects SET name = name || ''x'' WHERE bucket_id = ''artist-travel-documents'' RETURNING name')
  || '|' || bb_test.mem('master', 'DELETE FROM storage.objects WHERE bucket_id = ''artist-travel-documents'' RETURNING name'), 'NULL|NULL');
SELECT bb_test.eq('HOST-01 (local shape) other buckets are not affected by the restrictive policy',
  bb_test.mem('master', 'INSERT INTO storage.objects (bucket_id, name) VALUES (''other'', ''x'') RETURNING name'), 'x');
SELECT bb_test.eq('HOST-01 (local shape) objects of the bucket were not touched by provisioning',
  (SELECT (count(*) > 0)::text FROM storage.objects WHERE bucket_id = 'artist-travel-documents'), 'true');

CREATE TEMP VIEW postflight_end AS :postflight_sql ;
SELECT bb_test.eq('ACL-01 postflight still OK after every scenario',
  (SELECT item || ' ' || detail FROM postflight_end WHERE ord = 0), 'POSTFLIGHT OK failing: none');
\echo TRAVEL_DOCUMENTS_SQL_TESTS_PASSED
