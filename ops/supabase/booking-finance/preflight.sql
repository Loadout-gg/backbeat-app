-- Read-only preflight for migration 007 (booking finance). One pure SELECT: catalog reads and
-- row counts only, no row content. Run it before applying 007; it changes nothing.
-- Expected on staging before 007: marker class "staging", 004 and 005 applied,
-- "007 objects present" = 0/9, and the last row READY_FOR_007.
SELECT section, item, detail FROM (
  SELECT 1 AS ord, 'env' AS section, 'server' AS item,
         current_setting('server_version') || ' | current_date=' || current_date::text AS detail
  UNION ALL
  -- Marker class: development | staging | invalid | absent. 007 accepts development only
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
  SELECT 4, 'env', 'backbeat_touch_updated_at()',
         coalesce(to_regprocedure('public.backbeat_touch_updated_at()')::text, 'ABSENT')
  UNION ALL
  SELECT 10, 'table', 'bookings rls enabled',
         coalesce((SELECT c.relrowsecurity::text FROM pg_class c WHERE c.oid = to_regclass('public.bookings')), 'ABSENT')
  UNION ALL
  SELECT 11, 'migration', '004 applied (fee columns)',
         (SELECT count(*)::text || '/2' FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'bookings'
            AND column_name IN ('fee_amount_minor', 'fee_currency'))
  UNION ALL
  SELECT 12, 'migration', '005 applied (bookings_workspace_id_id_key)',
         (SELECT count(*)::text || '/1' FROM pg_constraint
          WHERE conrelid = to_regclass('public.bookings') AND conname = 'bookings_workspace_id_id_key' AND contype = 'u')
  UNION ALL
  SELECT 13, 'migration', '006 applied (bookings_enforce_status trigger)',
         (SELECT count(*)::text || '/1' FROM pg_trigger
          WHERE tgrelid = to_regclass('public.bookings') AND tgname = 'bookings_enforce_status' AND NOT tgisinternal)
  UNION ALL
  SELECT 14, 'migration', '007 objects present',
         ((SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public'
             AND ((table_name = 'bookings' AND column_name IN ('commission_type', 'commission_value', 'commission_mode', 'tax_note'))
               OR (table_name = 'artists' AND column_name IN ('default_commission_type', 'default_commission_value'))))
          + (CASE WHEN to_regclass('public.booking_payments') IS NULL THEN 0 ELSE 1 END)
          + (CASE WHEN to_regprocedure('public.backbeat_enforce_payment_currency()') IS NULL THEN 0 ELSE 1 END)
          + (CASE WHEN to_regprocedure('public.backbeat_enforce_booking_fee_currency()') IS NULL THEN 0 ELSE 1 END))::text || '/9'
  UNION ALL
  SELECT 15, 'migration', 'rollback backup tables present',
         ((CASE WHEN to_regclass('public.booking_payments_rollback_backup') IS NULL THEN 0 ELSE 1 END)
          + (CASE WHEN to_regclass('public.booking_finance_rollback_backup') IS NULL THEN 0 ELSE 1 END))::text || '/2'
  UNION ALL
  SELECT 20, 'data', 'bookings total / with fee',
         (SELECT count(*)::text || ' / ' || count(fee_currency)::text FROM public.bookings)
  UNION ALL
  SELECT 21, 'data', 'artists total', (SELECT count(*)::text FROM public.artists)
  UNION ALL
  SELECT 30, 'fk_into_bookings', con.conname::text, con.conrelid::regclass::text || ' ' || pg_get_constraintdef(con.oid)
  FROM pg_constraint con WHERE con.confrelid = to_regclass('public.bookings') AND con.contype = 'f'
  UNION ALL
  SELECT 40, 'trigger', t.tgname::text || ' enabled=' || t.tgenabled::text, pg_get_triggerdef(t.oid)
  FROM pg_trigger t WHERE t.tgrelid = to_regclass('public.bookings') AND NOT t.tgisinternal
  UNION ALL
  SELECT 99, 'summary', 'ready for 007',
         CASE WHEN to_regclass('public.runtime_environment') IS NOT NULL
               AND to_regprocedure('public.backbeat_is_active_member(uuid)') IS NOT NULL
               AND to_regprocedure('public.backbeat_touch_updated_at()') IS NOT NULL
               AND (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public'
                    AND table_name = 'bookings' AND column_name IN ('fee_amount_minor', 'fee_currency')) = 2
               AND EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = to_regclass('public.bookings')
                    AND conname = 'bookings_workspace_id_id_key' AND contype = 'u')
              THEN 'READY_FOR_007' ELSE 'NOT_READY: see the rows above' END
) r
ORDER BY ord, item;
