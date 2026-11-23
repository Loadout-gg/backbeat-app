-- Read-only preflight for migration 008 (booking -> event). One pure SELECT: catalog reads,
-- row counts, and the id + status of event rows that would violate the new status CHECK
-- (no title, no other row content). Run it before applying 008; it changes nothing.
-- Expected on staging before 008: marker class "staging", 005 applied, "008 objects present"
-- = 0/13, no "status_violation" row, and the last row READY_FOR_008.
SELECT section, item, detail FROM (
  SELECT 1 AS ord, 'env' AS section, 'server' AS item,
         current_setting('server_version') || ' | current_date=' || current_date::text AS detail
  UNION ALL
  -- Marker class: development | staging | invalid | absent. 008 accepts development only
  -- with target 'development' and staging only with the staging target.
  SELECT 2, 'env', 'runtime_environment marker class',
         CASE WHEN to_regclass('public.runtime_environment') IS NULL THEN 'absent'
              ELSE (xpath('/row/class/text()', query_to_xml(
                'SELECT CASE WHEN count(*) = 1 AND bool_and(id = ''backbeat-dev'' AND environment = ''development'' AND synthetic_only IS TRUE) THEN ''development'' WHEN count(*) = 1 AND bool_and(id = ''backbeat-staging'' AND environment = ''staging'' AND synthetic_only IS TRUE) THEN ''staging'' ELSE ''invalid'' END AS class FROM public.runtime_environment',
                false, true, '')))[1]::text END
  UNION ALL
  SELECT 3, 'env', 'backbeat_is_active_member(uuid)',
         coalesce(to_regprocedure('public.backbeat_is_active_member(uuid)')::text, 'ABSENT')
  UNION ALL
  SELECT 10, 'table', t.name || ' rls enabled',
         coalesce((SELECT c.relrowsecurity::text FROM pg_class c WHERE c.oid = to_regclass('public.' || t.name)), 'ABSENT')
  FROM (VALUES ('events'), ('bookings'), ('promoters')) AS t(name)
  UNION ALL
  SELECT 11, 'migration', '005 applied (bookings_workspace_id_id_key)',
         (SELECT count(*)::text || '/1' FROM pg_constraint
          WHERE conrelid = to_regclass('public.bookings') AND conname = 'bookings_workspace_id_id_key' AND contype = 'u')
  UNION ALL
  SELECT 12, 'migration', 'promoters UNIQUE (workspace_id, id)',
         (SELECT count(*)::text || '/1' FROM pg_constraint con
          WHERE con.conrelid = to_regclass('public.promoters') AND con.contype IN ('u', 'p')
            AND (SELECT array_agg(att.attname::text ORDER BY att.attname::text)
                 FROM unnest(con.conkey) k
                 JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = k)
                = ARRAY['id', 'workspace_id'])
  UNION ALL
  SELECT 13, 'migration', '008 objects present',
         ((SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public'
             AND ((table_name = 'events' AND column_name IN ('booking_id', 'start_time', 'fee_amount_minor', 'fee_currency'))
               OR (table_name = 'bookings' AND column_name = 'promoter_id')))
          + (SELECT count(*) FROM pg_constraint
             WHERE (conrelid = to_regclass('public.events') AND conname IN ('events_status_check',
                      'events_fee_amount_minor_check', 'events_fee_currency_check', 'events_fee_pair_check',
                      'events_workspace_id_id_key', 'events_booking_id_key', 'events_booking_id_fkey'))
                OR (conrelid = to_regclass('public.bookings') AND conname = 'bookings_promoter_id_fkey')))::text || '/13'
  UNION ALL
  SELECT 14, 'migration', 'rollback backup table present',
         (CASE WHEN to_regclass('public.booking_event_rollback_backup') IS NULL THEN 0 ELSE 1 END)::text || '/1'
  UNION ALL
  SELECT 20, 'column', 'events.' || a.attname::text,
         format_type(a.atttypid, a.atttypmod) || CASE WHEN a.attnotnull THEN ' NOT NULL' ELSE '' END
  FROM pg_attribute a
  WHERE a.attrelid = to_regclass('public.events') AND a.attnum > 0 AND NOT a.attisdropped
  UNION ALL
  SELECT 30, 'constraint', 'events.' || con.conname::text || ' [' || con.contype::text || ']', pg_get_constraintdef(con.oid)
  FROM pg_constraint con WHERE con.conrelid = to_regclass('public.events')
  UNION ALL
  SELECT 31, 'fk_into_bookings', con.conname::text, con.conrelid::regclass::text || ' ' || pg_get_constraintdef(con.oid)
  FROM pg_constraint con WHERE con.confrelid = to_regclass('public.bookings') AND con.contype = 'f'
  UNION ALL
  SELECT 32, 'fk_from_bookings', con.conname::text, pg_get_constraintdef(con.oid)
  FROM pg_constraint con WHERE con.conrelid = to_regclass('public.bookings') AND con.contype = 'f'
  UNION ALL
  SELECT 40, 'policy', p.tablename::text || '.' || p.policyname::text || ' [' || p.cmd || '] to ' || array_to_string(p.roles, ','),
         'USING ' || coalesce(p.qual, '-') || ' | CHECK ' || coalesce(p.with_check, '-')
  FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename IN ('events', 'bookings', 'promoters')
  UNION ALL
  SELECT 50, 'grant', g.table_name::text || ' -> ' || g.grantee::text,
         string_agg(g.privilege_type::text, ',' ORDER BY g.privilege_type::text)
  FROM information_schema.role_table_grants g
  WHERE g.table_schema = 'public' AND g.table_name IN ('events', 'bookings', 'promoters')
    AND g.grantee IN ('anon', 'authenticated', 'PUBLIC')
  GROUP BY g.table_name, g.grantee
  UNION ALL
  SELECT 60, 'data', 'events status ' || coalesce(e.status, 'NULL'), count(*)::text
  FROM public.events e GROUP BY e.status
  UNION ALL
  SELECT 61, 'data', 'events total / bookings total / promoters total',
         (SELECT count(*)::text FROM public.events) || ' / ' || (SELECT count(*)::text FROM public.bookings)
         || ' / ' || (SELECT count(*)::text FROM public.promoters)
  UNION ALL
  -- Decision 5: these rows make 008 refuse to run. Fix or delete them first, then re-run.
  SELECT 70, 'status_violation', 'event ' || e.id::text, 'workspace ' || e.workspace_id::text || ' | status ' || coalesce(e.status, 'NULL')
  FROM public.events e WHERE e.status IS NULL OR e.status NOT IN ('in_progress', 'confirmed', 'cancelled')
  UNION ALL
  SELECT 99, 'summary', 'ready for 008',
         CASE WHEN to_regclass('public.runtime_environment') IS NULL
                OR to_regprocedure('public.backbeat_is_active_member(uuid)') IS NULL
              THEN 'NOT_READY: marker table or membership helper missing'
              WHEN NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = to_regclass('public.bookings')
                    AND conname = 'bookings_workspace_id_id_key' AND contype = 'u')
              THEN 'NOT_READY: migration 005 is not applied'
              WHEN (SELECT count(*) FROM pg_class c WHERE c.relrowsecurity
                    AND c.oid IN (to_regclass('public.events'), to_regclass('public.bookings'), to_regclass('public.promoters'))) <> 3
              THEN 'NOT_READY: RLS is not enabled on events, bookings and promoters'
              WHEN EXISTS (SELECT 1 FROM public.events e
                    WHERE e.status IS NULL OR e.status NOT IN ('in_progress', 'confirmed', 'cancelled'))
              THEN 'BLOCKED: ' || (SELECT count(*)::text FROM public.events e
                    WHERE e.status IS NULL OR e.status NOT IN ('in_progress', 'confirmed', 'cancelled'))
                   || ' event row(s) violate the status CHECK (see status_violation rows)'
              ELSE 'READY_FOR_008' END
) r
ORDER BY ord, item;
