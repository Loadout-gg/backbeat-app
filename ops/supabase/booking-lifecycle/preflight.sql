-- Read-only preflight for migrations 005/006. Catalog reads plus count(*) on bookings;
-- no row content is returned. If the SQL editor shows only the final ROLLBACK, run the
-- SELECT statement alone (it is a pure SELECT).
BEGIN TRANSACTION READ ONLY;

SELECT section, item, detail FROM (
  SELECT 1 AS ord, 'env' AS section, 'server' AS item,
         current_setting('server_version') || ' | tz=' || current_setting('TimeZone')
         || ' | current_date=' || current_date::text AS detail
  UNION ALL
  SELECT 2, 'env', 'runtime_environment table',
         coalesce(to_regclass('public.runtime_environment')::text, 'ABSENT')
  UNION ALL
  SELECT 3, 'env', 'backbeat_is_active_member(uuid)',
         coalesce(to_regprocedure('public.backbeat_is_active_member(uuid)')::text, 'ABSENT')
  UNION ALL
  SELECT 4, 'env', 'backbeat_touch_updated_at()',
         coalesce(to_regprocedure('public.backbeat_touch_updated_at()')::text, 'ABSENT')
  UNION ALL
  SELECT 5, 'env', 'backbeat_enforce_booking_status()',
         coalesce(to_regprocedure('public.backbeat_enforce_booking_status()')::text, 'ABSENT')
  UNION ALL
  SELECT 10, 'table', 'bookings rls enabled/forced',
         c.relrowsecurity::text || '/' || c.relforcerowsecurity::text
         || ' | owner=' || pg_get_userbyid(c.relowner)::text
  FROM pg_class c WHERE c.oid = to_regclass('public.bookings')
  UNION ALL
  SELECT 11, 'migration', '002 applied (5 cols)',
         (SELECT count(*)::text || '/5' FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'bookings'
            AND column_name IN ('venue_name','venue_address','contact_name_main',
                                'contact_phone_main','contact_email_main'))
  UNION ALL
  SELECT 12, 'migration', '004 applied (2 cols)',
         (SELECT count(*)::text || '/2' FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'bookings'
            AND column_name IN ('fee_amount_minor','fee_currency'))
  UNION ALL
  SELECT 13, 'migration', 'hold_expires_on present',
         (SELECT count(*)::text FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'bookings'
            AND column_name = 'hold_expires_on')
  UNION ALL
  SELECT 20, 'column', a.attnum::text || ' ' || a.attname::text,
         format_type(a.atttypid, a.atttypmod)
         || CASE WHEN a.attnotnull THEN ' NOT NULL' ELSE '' END
         || coalesce(' DEFAULT ' || pg_get_expr(d.adbin, d.adrelid), '')
  FROM pg_attribute a
  LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
  WHERE a.attrelid = to_regclass('public.bookings') AND a.attnum > 0 AND NOT a.attisdropped
  UNION ALL
  SELECT 30, 'constraint', con.conname::text || ' [' || con.contype::text || ']',
         pg_get_constraintdef(con.oid)
  FROM pg_constraint con WHERE con.conrelid = to_regclass('public.bookings')
  UNION ALL
  SELECT 31, 'check', 'UNIQUE (workspace_id, id) exists',
         (SELECT count(*)::text FROM pg_constraint con
          WHERE con.conrelid = to_regclass('public.bookings') AND con.contype IN ('u','p')
            AND (SELECT array_agg(att.attname::text ORDER BY att.attname::text)
                 FROM unnest(con.conkey) k
                 JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = k)
                = ARRAY['id','workspace_id'])
  UNION ALL
  SELECT 40, 'index', i.indexname::text, i.indexdef
  FROM pg_indexes i WHERE i.schemaname = 'public' AND i.tablename = 'bookings'
  UNION ALL
  SELECT 50, 'policy', p.policyname::text || ' [' || p.cmd || '] to ' || array_to_string(p.roles, ','),
         'USING ' || coalesce(p.qual, '-') || ' | CHECK ' || coalesce(p.with_check, '-')
  FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = 'bookings'
  UNION ALL
  SELECT 60, 'trigger', t.tgname::text || ' enabled=' || t.tgenabled::text, pg_get_triggerdef(t.oid)
  FROM pg_trigger t WHERE t.tgrelid = to_regclass('public.bookings') AND NOT t.tgisinternal
  UNION ALL
  SELECT 70, 'grant', g.grantee::text, string_agg(g.privilege_type::text, ',' ORDER BY g.privilege_type::text)
  FROM information_schema.role_table_grants g
  WHERE g.table_schema = 'public' AND g.table_name = 'bookings'
  GROUP BY g.grantee
  UNION ALL
  SELECT 80, 'fk_into_bookings', con.conname::text, con.conrelid::regclass::text
         || ' ' || pg_get_constraintdef(con.oid)
  FROM pg_constraint con
  WHERE con.confrelid = to_regclass('public.bookings') AND con.contype = 'f'
  UNION ALL
  SELECT 90, 'status_count', s.status, count(*)::text
  FROM public.bookings s GROUP BY s.status
  UNION ALL
  SELECT 91, 'status_count', 'TOTAL', (SELECT count(*)::text FROM public.bookings)
  UNION ALL
  SELECT 92, 'data', 'duplicate (workspace_id, id)',
         (SELECT count(*)::text FROM (SELECT 1 FROM public.bookings
          GROUP BY workspace_id, id HAVING count(*) > 1) x)
) r
ORDER BY ord, item;

ROLLBACK;
