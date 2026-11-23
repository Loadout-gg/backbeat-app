-- Read-only preflight for migration 009 (booking travel, stays, artist travel documents).
-- One SELECT, catalog reads and row counts only: no row content is returned.
-- Expect: marker class = staging (on staging), every "requires" row = ok, every "009" row = absent
-- before the first apply. The first row (ord 0) is the summary.
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
               ('public.booking_travel_legs_rollback_backup'), ('public.booking_stays_rollback_backup'),
               ('public.artist_travel_documents_rollback_backup'), ('public.artists_date_of_birth_rollback_backup')) AS t(name)
  UNION ALL
  SELECT 11, '009', 'artists.date_of_birth',
         CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
           AND table_name = 'artists' AND column_name = 'date_of_birth') THEN 'present' ELSE 'absent' END, true
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
