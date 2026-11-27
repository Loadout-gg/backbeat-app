-- Read-only preflight for migration 009 (booking travel, stays, artist travel documents with scan
-- versions, audit and relationship signal, bookings.transport_to_city).
-- One SELECT, catalog reads and row counts only: no row content is returned.
-- Expect: marker class = staging (on staging), every "requires" row = ok, every "009" row = absent
-- before the first apply. The first row (ord 0) is the summary. The "storage" rows are
-- informational: the bucket is provisioned separately (storage-provision.sql), never by 009.
WITH checks(ord, section, item, detail, ok) AS (
  SELECT 1, 'env', 'server', current_setting('server_version') || ' | tz=' || current_setting('TimeZone'), true
  UNION ALL
  SELECT 2, 'env', 'runtime_environment marker class', m.class, m.class IN ('development', 'staging')
  FROM (SELECT CASE WHEN to_regclass('public.runtime_environment') IS NULL THEN 'absent'
              ELSE (xpath('/row/class/text()', query_to_xml(
                'SELECT CASE WHEN count(*) = 1 AND bool_and(id = ''backbeat-dev'' AND environment = ''development'' AND synthetic_only IS TRUE) THEN ''development'' WHEN count(*) = 1 AND bool_and(id = ''backbeat-staging'' AND environment = ''staging'' AND synthetic_only IS TRUE) THEN ''staging'' ELSE ''invalid'' END AS class FROM public.runtime_environment',
                false, true, '')))[1]::text END AS class) AS m
  UNION ALL
  SELECT 3, 'requires', 'backbeat_is_active_member(uuid)',
         coalesce(to_regprocedure('public.backbeat_is_active_member(uuid)')::text, 'ABSENT'),
         to_regprocedure('public.backbeat_is_active_member(uuid)') IS NOT NULL
  UNION ALL
  SELECT 4, 'requires', t.name || ' rls enabled',
         coalesce((SELECT relrowsecurity::text FROM pg_class WHERE oid = to_regclass(t.name)), 'ABSENT'),
         coalesce((SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass(t.name)), false)
  FROM (VALUES ('public.bookings'), ('public.artists'), ('public.workspaces')) AS t(name)
  UNION ALL
  SELECT 5, 'requires', '005 bookings_workspace_id_id_key',
         (SELECT count(*)::text FROM pg_constraint WHERE conrelid = to_regclass('public.bookings')
            AND conname = 'bookings_workspace_id_id_key' AND contype = 'u'),
         EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = to_regclass('public.bookings')
            AND conname = 'bookings_workspace_id_id_key' AND contype = 'u')
  UNION ALL
  SELECT 6, 'requires', 'artists UNIQUE (workspace_id, id)',
         (SELECT count(*)::text FROM pg_constraint con
          WHERE con.conrelid = to_regclass('public.artists') AND con.contype IN ('u','p')
            AND (SELECT array_agg(att.attname::text ORDER BY att.attname::text)
                 FROM unnest(con.conkey) k JOIN pg_attribute att
                   ON att.attrelid = con.conrelid AND att.attnum = k) = ARRAY['id','workspace_id']),
         EXISTS (SELECT 1 FROM pg_constraint con
          WHERE con.conrelid = to_regclass('public.artists') AND con.contype IN ('u','p')
            AND (SELECT array_agg(att.attname::text ORDER BY att.attname::text)
                 FROM unnest(con.conkey) k JOIN pg_attribute att
                   ON att.attrelid = con.conrelid AND att.attnum = k) = ARRAY['id','workspace_id'])
  UNION ALL
  SELECT 10, '009', t.name, CASE WHEN to_regclass(t.name) IS NULL THEN 'absent' ELSE 'present' END, true
  FROM (VALUES ('public.booking_travel_legs'), ('public.booking_stays'), ('public.artist_travel_documents'),
               ('public.artist_travel_document_files'), ('public.artist_travel_document_audit'),
               ('public.artist_travel_document_relationships'),
               ('public.booking_travel_legs_rollback_backup'), ('public.booking_stays_rollback_backup'),
               ('public.artist_travel_documents_rollback_backup'),
               ('public.artist_travel_document_files_rollback_backup'),
               ('public.artist_travel_document_audit_rollback_backup'),
               ('public.artist_travel_document_relationships_rollback_backup'),
               ('public.artists_date_of_birth_rollback_backup'),
               ('public.bookings_transport_to_city_rollback_backup')) AS t(name)
  UNION ALL
  SELECT 11, '009', c.tbl || '.' || c.col,
         CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
           AND table_name = c.tbl AND column_name = c.col) THEN 'present' ELSE 'absent' END, true
  FROM (VALUES ('artists', 'date_of_birth'), ('bookings', 'transport_to_city')) AS c(tbl, col)
  UNION ALL
  SELECT 12, '009', 'backbeat_travel_document_* functions',
         (SELECT count(*)::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public' AND p.proname LIKE 'backbeat\_travel\_document\_%'), true
  UNION ALL
  SELECT 13, 'requires', 'SQLSTATE BB012-BB021 unused by existing functions',
         (SELECT count(*)::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public' AND p.proname NOT LIKE 'backbeat\_travel\_document\_%'
            AND p.prosrc ~ 'BB0(1[2-9]|2[01])'),
         NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public' AND p.proname NOT LIKE 'backbeat\_travel\_document\_%'
            AND p.prosrc ~ 'BB0(1[2-9]|2[01])')
  UNION ALL
  SELECT 14, 'requires', 'events.artist_id and bookings.artist_id (download context)',
         (SELECT count(*)::text FROM information_schema.columns WHERE table_schema = 'public'
            AND table_name IN ('events', 'bookings') AND column_name = 'artist_id'),
         (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public'
            AND table_name IN ('events', 'bookings') AND column_name = 'artist_id') = 2
  UNION ALL
  SELECT 15, 'requires', 'role service_role',
         (SELECT count(*)::text FROM pg_roles WHERE rolname = 'service_role'),
         EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role')
  UNION ALL
  SELECT 30, 'storage', 'storage.objects catalog (informational)',
         CASE WHEN to_regclass('storage.objects') IS NULL THEN 'absent' ELSE 'present' END, true
  UNION ALL
  SELECT 31, 'storage', 'bucket artist-travel-documents (informational; not created by 009)',
         CASE WHEN to_regclass('storage.buckets') IS NULL THEN 'storage schema absent'
              ELSE (xpath('/row/state/text()', query_to_xml(
                'SELECT CASE WHEN count(*) = 0 THEN ''absent'' WHEN bool_and(public IS FALSE) THEN ''present, private'' ELSE ''present, PUBLIC'' END AS state FROM storage.buckets WHERE id = ''artist-travel-documents''',
                false, true, '')))[1]::text END, true
  UNION ALL
  SELECT 20, 'data', 'bookings / artists rows',
         (SELECT count(*)::text FROM public.bookings) || ' / ' || (SELECT count(*)::text FROM public.artists), true
)
SELECT ord, section, item, detail FROM (
  SELECT 0 AS ord, 'summary' AS section,
         CASE WHEN bool_and(ok) THEN 'PREFLIGHT READY' ELSE 'PREFLIGHT BLOCKED' END AS item,
         'failing: ' || coalesce(string_agg(item, ', ') FILTER (WHERE NOT ok), 'none') AS detail
  FROM checks
  UNION ALL
  SELECT ord, section, item, detail FROM checks
) AS report
ORDER BY ord, item;
