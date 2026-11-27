-- Read-only postflight for migration 009. One SELECT, catalog reads and row counts only.
-- The first row (ord 0) is the summary: expect "POSTFLIGHT OK" and "failing: none".
-- Checked on the real objects: RLS, policies, effective table / column / function privileges of
-- anon, authenticated and service_role (inherited and default grants included, through
-- has_*_privilege), foreign keys, triggers, function settings and the new columns.
WITH t(name, policies, table_privs, parent_fk) AS (
  VALUES
    ('booking_travel_legs', 'booking_travel_leg_access:ALL', 'DELETE,INSERT,SELECT', 'booking_travel_legs_booking_fkey'),
    ('booking_stays', 'booking_stay_access:ALL', 'DELETE,INSERT,SELECT', 'booking_stays_booking_fkey'),
    ('artist_travel_documents',
     'artist_travel_document_create:INSERT,artist_travel_document_edit:UPDATE,artist_travel_document_read:SELECT',
     'SELECT', 'artist_travel_documents_artist_fkey'),
    ('artist_travel_document_files', 'artist_travel_document_file_read:SELECT', '', 'artist_travel_document_files_document_fkey'),
    ('artist_travel_document_audit', 'artist_travel_document_audit_read:SELECT', 'SELECT', NULL),
    ('artist_travel_document_relationships', 'artist_travel_document_relationship_read:SELECT', 'SELECT',
     'artist_travel_document_relationships_artist_fkey')
), fn(name, caller) AS (
  VALUES
    ('backbeat_travel_document_cutoff', 'none'), ('backbeat_travel_document_is_member', 'none'),
    ('backbeat_travel_document_audit_write', 'none'), ('backbeat_travel_document_archive_row', 'none'),
    ('backbeat_travel_document_scrub', 'none'), ('backbeat_travel_document_audit_guard', 'none'),
    ('backbeat_travel_document_protect', 'none'), ('backbeat_travel_document_card_audit', 'none'),
    ('backbeat_travel_document_archive', 'authenticated'), ('backbeat_travel_document_restore', 'authenticated'),
    ('backbeat_travel_document_relationship_end', 'authenticated'),
    ('backbeat_travel_document_relationship_resume', 'authenticated'),
    ('backbeat_travel_document_reserve_upload', 'service_role'),
    ('backbeat_travel_document_pending_key', 'service_role'),
    ('backbeat_travel_document_finalize_upload', 'service_role'),
    ('backbeat_travel_document_authorize_download', 'service_role'),
    ('backbeat_travel_document_record_issuance', 'service_role'),
    ('backbeat_travel_document_restore_probe', 'service_role'),
    ('backbeat_travel_document_confirm_restored_file', 'service_role'),
    ('backbeat_travel_document_purge_claim', 'service_role'),
    ('backbeat_travel_document_cleanup_claim', 'service_role'),
    ('backbeat_travel_document_purge_due', 'service_role'),
    ('backbeat_travel_document_purge_worklist', 'service_role'),
    ('backbeat_travel_document_purge_confirm', 'service_role'),
    ('backbeat_travel_document_audit_retention_purge', 'service_role')
), api(role) AS (
  SELECT r.rolname::text FROM pg_roles r WHERE r.rolname IN ('anon', 'authenticated', 'service_role')
), privs(name, role, held) AS (
  SELECT t.name, api.role,
         coalesce((SELECT string_agg(p.priv, ',' ORDER BY p.priv)
                   FROM unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) AS p(priv)
                   WHERE has_table_privilege(api.role, to_regclass('public.' || t.name), p.priv)), '')
  FROM t CROSS JOIN api WHERE to_regclass('public.' || t.name) IS NOT NULL
), colprivs(name, role, priv, cols) AS (
  SELECT t.name, api.role, p.priv,
         coalesce((SELECT string_agg(a.attname::text, ',' ORDER BY a.attname::text) FROM pg_attribute a
                   WHERE a.attrelid = to_regclass('public.' || t.name) AND a.attnum > 0 AND NOT a.attisdropped
                     AND has_column_privilege(api.role, a.attrelid, a.attnum, p.priv)), '')
  FROM t CROSS JOIN api CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE')) AS p(priv)
  WHERE to_regclass('public.' || t.name) IS NOT NULL
), fncallers(name, callers, definitions) AS (
  SELECT fn.name,
         coalesce((SELECT string_agg(x.who, ',' ORDER BY x.who) FROM (
             SELECT api.role AS who FROM api, pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = 'public' AND p.proname = fn.name AND has_function_privilege(api.role, p.oid, 'EXECUTE')
             UNION
             SELECT 'PUBLIC' FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = 'public' AND p.proname = fn.name
               AND EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                           WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')) AS x), 'none'),
         (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public' AND p.proname = fn.name)
  FROM fn
), checks(ord, section, item, detail, ok) AS (
  SELECT 1, 'table', t.name || ' exists / rls',
         coalesce((SELECT 'present / ' || relrowsecurity::text FROM pg_class
                   WHERE oid = to_regclass('public.' || t.name)), 'ABSENT'),
         coalesce((SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass('public.' || t.name)), false)
  FROM t
  UNION ALL
  SELECT 2, 'policy', t.name || ' policies (authenticated, active member)',
         coalesce((SELECT string_agg(p.policyname || ':' || p.cmd, ',' ORDER BY p.policyname)
                   FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = t.name), 'none'),
         coalesce((SELECT string_agg(p.policyname || ':' || p.cmd, ',' ORDER BY p.policyname)
                   FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = t.name), '') = t.policies
         AND NOT EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = t.name
           AND (p.roles <> ARRAY['authenticated']::name[] OR p.permissive <> 'PERMISSIVE'
             OR coalesce(p.qual, p.with_check) NOT LIKE '%backbeat_is_active_member(workspace_id)%'))
  FROM t
  UNION ALL
  SELECT 3, 'grant', t.name || ' table privileges: anon / authenticated',
         (SELECT string_agg(v.role || '=[' || v.held || ']', ' ' ORDER BY v.role) FROM privs v
          WHERE v.name = t.name AND v.role IN ('anon', 'authenticated')),
         NOT EXISTS (SELECT 1 FROM privs v WHERE v.name = t.name
           AND ((v.role = 'anon' AND v.held <> '') OR (v.role = 'authenticated' AND v.held <> t.table_privs)))
  FROM t
  UNION ALL
  SELECT 4, 'grant', t.name || ' anon column privileges',
         coalesce((SELECT string_agg(c.priv || '=[' || c.cols || ']', ' ' ORDER BY c.priv) FROM colprivs c
                   WHERE c.name = t.name AND c.role = 'anon' AND c.cols <> ''), 'none'),
         NOT EXISTS (SELECT 1 FROM colprivs c WHERE c.name = t.name AND c.role = 'anon' AND c.cols <> '')
  FROM t
  UNION ALL
  SELECT 5, 'grant', c.name || ' authenticated ' || c.priv || ' columns',
         '[' || c.cols || ']', c.cols = e.cols
  FROM colprivs c JOIN (VALUES
    ('booking_travel_legs', 'UPDATE', 'arrive_date,arrive_place,arrive_time,arrive_zone,carrier,depart_date,depart_place,depart_time,depart_zone,direction,driver_name,driver_phone,mode,notes,reference,travellers,updated_at'),
    ('booking_stays', 'UPDATE', 'address,check_in_on,check_out_on,confirmation_ref,name,notes,updated_at'),
    ('artist_travel_documents', 'INSERT', 'artist_id,doc_type,expires_on,holder_name,issued_on,issuing_country,nationality,number,workspace_id'),
    ('artist_travel_documents', 'UPDATE', 'doc_type,expires_on,holder_name,issued_on,issuing_country,nationality,number,updated_at'),
    ('artist_travel_document_files', 'SELECT', 'archived_at,artist_id,byte_size,document_id,finalized_at,id,media_type,reserved_at,restore_until,state,workspace_id'),
    ('artist_travel_document_files', 'INSERT', ''), ('artist_travel_document_files', 'UPDATE', ''),
    ('artist_travel_document_audit', 'INSERT', ''), ('artist_travel_document_audit', 'UPDATE', ''),
    ('artist_travel_document_relationships', 'INSERT', ''), ('artist_travel_document_relationships', 'UPDATE', '')
  ) AS e(name, priv, cols) ON e.name = c.name AND e.priv = c.priv
  WHERE c.role = 'authenticated'
  UNION ALL
  SELECT 6, 'grant', v.name || ' service_role table privileges (expected none)',
         '[' || v.held || '] columns: ' || coalesce((SELECT string_agg(c.priv || '=[' || c.cols || ']', ' ')
           FROM colprivs c WHERE c.name = v.name AND c.role = 'service_role' AND c.cols <> ''), 'none'),
         v.held = '' AND NOT EXISTS (SELECT 1 FROM colprivs c
           WHERE c.name = v.name AND c.role = 'service_role' AND c.cols <> '')
  FROM privs v WHERE v.role = 'service_role' AND v.name LIKE 'artist\_travel\_document%'
  UNION ALL
  SELECT 7, 'fk', t.name || ' parent key',
         coalesce((SELECT pg_get_constraintdef(con.oid) FROM pg_constraint con
                   WHERE con.conrelid = to_regclass('public.' || t.name) AND con.conname = t.parent_fk), 'ABSENT'),
         coalesce((SELECT pg_get_constraintdef(con.oid) LIKE 'FOREIGN KEY (workspace_id, %) REFERENCES %(workspace_id, %id) ON DELETE CASCADE'
                   FROM pg_constraint con
                   WHERE con.conrelid = to_regclass('public.' || t.name) AND con.conname = t.parent_fk), false)
  FROM t WHERE t.parent_fk IS NOT NULL
  UNION ALL
  SELECT 8, 'fk', 'artist_travel_document_audit has no foreign key',
         (SELECT count(*)::text FROM pg_constraint con
          WHERE con.conrelid = to_regclass('public.artist_travel_document_audit') AND con.contype = 'f'),
         to_regclass('public.artist_travel_document_audit') IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM pg_constraint con
          WHERE con.conrelid = to_regclass('public.artist_travel_document_audit') AND con.contype = 'f')
  UNION ALL
  SELECT 9, 'fk', 'artist_travel_documents current scan binding',
         coalesce((SELECT pg_get_constraintdef(con.oid) FROM pg_constraint con
                   WHERE con.conrelid = to_regclass('public.artist_travel_documents')
                     AND con.conname = 'artist_travel_documents_current_file_fkey'), 'ABSENT'),
         EXISTS (SELECT 1 FROM pg_constraint con
                 WHERE con.conrelid = to_regclass('public.artist_travel_documents')
                   AND con.conname = 'artist_travel_documents_current_file_fkey'
                   AND pg_get_constraintdef(con.oid) = 'FOREIGN KEY (workspace_id, artist_id, id, current_file_id) REFERENCES artist_travel_document_files(workspace_id, artist_id, document_id, id)')
  UNION ALL
  SELECT 10, 'check', t.name || ' CHECK constraints',
         (SELECT count(*)::text FROM pg_constraint con
          WHERE con.conrelid = to_regclass('public.' || t.name) AND con.contype = 'c'),
         (SELECT count(*) FROM pg_constraint con
          WHERE con.conrelid = to_regclass('public.' || t.name) AND con.contype = 'c')
           = CASE t.name WHEN 'booking_travel_legs' THEN 5 WHEN 'booking_stays' THEN 2
               WHEN 'artist_travel_documents' THEN 5 WHEN 'artist_travel_document_files' THEN 5
               WHEN 'artist_travel_document_audit' THEN 2 ELSE 0 END
  FROM t
  UNION ALL
  SELECT 11, 'trigger', g.tbl || ' ' || g.trg,
         coalesce((SELECT 'enabled=' || tg.tgenabled::text FROM pg_trigger tg
                   WHERE tg.tgrelid = to_regclass('public.' || g.tbl) AND tg.tgname = g.trg), 'ABSENT'),
         EXISTS (SELECT 1 FROM pg_trigger tg
                 WHERE tg.tgrelid = to_regclass('public.' || g.tbl) AND tg.tgname = g.trg AND tg.tgenabled = 'O')
  FROM (VALUES ('artist_travel_document_audit', 'artist_travel_document_audit_append_only'),
               ('artist_travel_document_audit', 'artist_travel_document_audit_no_truncate'),
               ('artist_travel_documents', 'artist_travel_documents_protect'),
               ('artist_travel_document_files', 'artist_travel_document_files_protect'),
               ('artist_travel_documents', 'artist_travel_documents_relationship'),
               ('artist_travel_documents', 'artist_travel_documents_audit')) AS g(tbl, trg)
  UNION ALL
  SELECT 12, 'function', f.name || ' callers (expected ' || fn.caller || ')',
         f.callers || ' / definitions=' || f.definitions,
         f.callers = fn.caller AND f.definitions = 1
  FROM fncallers f JOIN fn ON fn.name = f.name
  UNION ALL
  SELECT 13, 'function', 'backbeat_travel_document_* functions: count and empty search_path',
         (SELECT count(*)::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public' AND p.proname LIKE 'backbeat\_travel\_document\_%')
         || ' functions, ' || (SELECT count(*)::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public' AND p.proname LIKE 'backbeat\_travel\_document\_%'
            AND NOT coalesce(p.proconfig, '{}') @> ARRAY['search_path=""']) || ' without',
         NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public' AND p.proname LIKE 'backbeat\_travel\_document\_%'
            AND NOT coalesce(p.proconfig, '{}') @> ARRAY['search_path=""'])
         AND (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'public' AND p.proname LIKE 'backbeat\_travel\_document\_%') = (SELECT count(*) FROM fn)
  UNION ALL
  SELECT 14, 'column', c.tbl || '.' || c.col,
         coalesce((SELECT data_type || ' nullable=' || is_nullable FROM information_schema.columns
                   WHERE table_schema = 'public' AND table_name = c.tbl AND column_name = c.col), 'ABSENT'),
         EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
           AND table_name = c.tbl AND column_name = c.col AND data_type = c.typ AND is_nullable = 'YES')
  FROM (VALUES ('artists', 'date_of_birth', 'date'), ('bookings', 'transport_to_city', 'text'),
               ('artist_travel_documents', 'nationality', 'text'), ('artist_travel_documents', 'issued_on', 'date'),
               ('artist_travel_documents', 'issuing_country', 'text'), ('artist_travel_documents', 'expires_on', 'date'),
               ('artist_travel_documents', 'holder_name', 'text')) AS c(tbl, col, typ)
  UNION ALL
  SELECT 15, 'column', 'artists_date_of_birth_check / bookings_transport_to_city_check',
         (SELECT count(*)::text FROM pg_constraint WHERE (conrelid, conname) IN (
            (to_regclass('public.artists'), 'artists_date_of_birth_check'),
            (to_regclass('public.bookings'), 'bookings_transport_to_city_check'))),
         (SELECT count(*) FROM pg_constraint WHERE (conrelid, conname) IN (
            (to_regclass('public.artists'), 'artists_date_of_birth_check'),
            (to_regclass('public.bookings'), 'bookings_transport_to_city_check'))) = 2
  UNION ALL
  SELECT 16, 'data', t.name || ' rows',
         (xpath('/row/n/text()', query_to_xml(
           format('SELECT count(*) AS n FROM public.%I', t.name), false, true, '')))[1]::text, true
  FROM t WHERE to_regclass('public.' || t.name) IS NOT NULL
  UNION ALL
  SELECT 17, 'parent', 'bookings / artists policies unchanged',
         (SELECT string_agg(p.tablename || ':' || p.policyname || ':' || p.cmd, ',' ORDER BY p.tablename)
          FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename IN ('bookings', 'artists')),
         true
  UNION ALL
  SELECT 18, 'storage', 'bucket artist-travel-documents (informational; provisioned separately)',
         CASE WHEN to_regclass('storage.buckets') IS NULL THEN 'storage schema absent'
              ELSE (xpath('/row/state/text()', query_to_xml(
                'SELECT CASE WHEN count(*) = 0 THEN ''absent'' WHEN bool_and(public IS FALSE) THEN ''present, private'' ELSE ''present, PUBLIC'' END AS state FROM storage.buckets WHERE id = ''artist-travel-documents''',
                false, true, '')))[1]::text END, true
)
SELECT ord, section, item, detail FROM (
  SELECT 0 AS ord, 'summary' AS section,
         CASE WHEN bool_and(ok) THEN 'POSTFLIGHT OK' ELSE 'POSTFLIGHT FAILED' END AS item,
         'failing: ' || coalesce(string_agg(item, ', ') FILTER (WHERE NOT ok), 'none') AS detail
  FROM checks
  UNION ALL
  SELECT ord, section, item, detail FROM checks
) AS report
ORDER BY ord, item;
