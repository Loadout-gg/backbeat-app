-- Read-only postflight for migration 009. One SELECT, catalog reads and row counts only.
-- The first row (ord 0) is the summary: expect "POSTFLIGHT OK" and "failing: none".
WITH t(name, policy, parent_fk, update_cols) AS (
  VALUES
    ('booking_travel_legs', 'booking_travel_leg_access', 'booking_travel_legs_booking_fkey', 17),
    ('booking_stays', 'booking_stay_access', 'booking_stays_booking_fkey', 7),
    ('artist_travel_documents', 'artist_travel_document_access', 'artist_travel_documents_artist_fkey', 6)
), checks(ord, section, item, detail, ok) AS (
  SELECT 1, 'table', t.name || ' exists / rls',
         coalesce((SELECT 'present / ' || relrowsecurity::text FROM pg_class
                   WHERE oid = to_regclass('public.' || t.name)), 'ABSENT'),
         coalesce((SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass('public.' || t.name)), false)
  FROM t
  UNION ALL
  SELECT 2, 'policy', t.name || ' policies',
         coalesce((SELECT string_agg(p.policyname || ':' || p.cmd || ':' || array_to_string(p.roles, ','), ',')
                   FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = t.name), 'none'),
         coalesce((SELECT string_agg(p.policyname || ':' || p.cmd || ':' || array_to_string(p.roles, ','), ',')
                   FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = t.name), '')
           = t.policy || ':ALL:authenticated'
         AND EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = t.name
           AND p.qual LIKE '%backbeat_is_active_member(workspace_id)%'
           AND p.with_check LIKE '%backbeat_is_active_member(workspace_id)%')
  FROM t
  UNION ALL
  SELECT 3, 'grant', t.name || ' table grants',
         coalesce((SELECT string_agg(g.grantee || ':' || g.privilege_type, ',' ORDER BY g.grantee, g.privilege_type)
                   FROM information_schema.role_table_grants g
                   WHERE g.table_schema = 'public' AND g.table_name = t.name
                     AND g.grantee IN ('anon', 'authenticated', 'PUBLIC')), 'none'),
         coalesce((SELECT string_agg(g.grantee || ':' || g.privilege_type, ',' ORDER BY g.grantee, g.privilege_type)
                   FROM information_schema.role_table_grants g
                   WHERE g.table_schema = 'public' AND g.table_name = t.name
                     AND g.grantee IN ('anon', 'authenticated', 'PUBLIC')), '')
           = 'authenticated:DELETE,authenticated:INSERT,authenticated:SELECT'
  FROM t
  UNION ALL
  SELECT 4, 'grant', t.name || ' column UPDATE grants (authenticated)',
         (SELECT count(*)::text FROM information_schema.column_privileges c
          WHERE c.table_schema = 'public' AND c.table_name = t.name AND c.grantee = 'authenticated'
            AND c.privilege_type = 'UPDATE') || ' columns, parent key updatable: '
         || EXISTS (SELECT 1 FROM information_schema.column_privileges c
            WHERE c.table_schema = 'public' AND c.table_name = t.name AND c.grantee = 'authenticated'
              AND c.privilege_type = 'UPDATE'
              AND c.column_name IN ('id', 'workspace_id', 'booking_id', 'artist_id', 'created_at'))::text,
         (SELECT count(*) FROM information_schema.column_privileges c
          WHERE c.table_schema = 'public' AND c.table_name = t.name AND c.grantee = 'authenticated'
            AND c.privilege_type = 'UPDATE') = t.update_cols
         AND NOT EXISTS (SELECT 1 FROM information_schema.column_privileges c
            WHERE c.table_schema = 'public' AND c.table_name = t.name AND c.grantee IN ('authenticated', 'anon')
              AND c.privilege_type = 'UPDATE'
              AND c.column_name IN ('id', 'workspace_id', 'booking_id', 'artist_id', 'created_at'))
  FROM t
  UNION ALL
  SELECT 5, 'fk', t.name || ' parent key',
         coalesce((SELECT pg_get_constraintdef(con.oid) FROM pg_constraint con
                   WHERE con.conrelid = to_regclass('public.' || t.name) AND con.conname = t.parent_fk), 'ABSENT'),
         coalesce((SELECT pg_get_constraintdef(con.oid) LIKE 'FOREIGN KEY (workspace_id, %) REFERENCES %(workspace_id, id) ON DELETE CASCADE'
                   FROM pg_constraint con
                   WHERE con.conrelid = to_regclass('public.' || t.name) AND con.conname = t.parent_fk), false)
  FROM t
  UNION ALL
  SELECT 6, 'check', t.name || ' CHECK constraints',
         (SELECT count(*)::text FROM pg_constraint con
          WHERE con.conrelid = to_regclass('public.' || t.name) AND con.contype = 'c'),
         (SELECT count(*) FROM pg_constraint con
          WHERE con.conrelid = to_regclass('public.' || t.name) AND con.contype = 'c')
           = CASE t.name WHEN 'booking_travel_legs' THEN 5 ELSE 2 END
  FROM t
  UNION ALL
  SELECT 7, 'data', t.name || ' rows',
         (xpath('/row/n/text()', query_to_xml(
           format('SELECT count(*) AS n FROM public.%I', t.name), false, true, '')))[1]::text, true
  FROM t WHERE to_regclass('public.' || t.name) IS NOT NULL
  UNION ALL
  SELECT 8, 'column', 'artists.date_of_birth',
         coalesce((SELECT data_type || ' nullable=' || is_nullable FROM information_schema.columns
                   WHERE table_schema = 'public' AND table_name = 'artists' AND column_name = 'date_of_birth'), 'ABSENT'),
         EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
           AND table_name = 'artists' AND column_name = 'date_of_birth' AND data_type = 'date' AND is_nullable = 'YES')
         AND EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = to_regclass('public.artists')
           AND conname = 'artists_date_of_birth_check')
  UNION ALL
  SELECT 9, 'parent', 'bookings / artists policies unchanged',
         (SELECT string_agg(p.tablename || ':' || p.policyname || ':' || p.cmd, ',' ORDER BY p.tablename)
          FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename IN ('bookings', 'artists')),
         true
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
