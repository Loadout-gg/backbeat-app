-- Read-only postflight for migration 007 (booking finance). One pure SELECT over the catalog.
-- Every row must say PASS; the last row is the summary (ALL PASS: n/n).
WITH checks(ord, item, ok, detail) AS (
  SELECT 1, 'bookings: commission and tax note columns',
         count(*) = 4, count(*)::text || '/4'
  FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'bookings'
    AND column_name IN ('commission_type', 'commission_value', 'commission_mode', 'tax_note')
  UNION ALL
  SELECT 2, 'bookings: commission and tax note CHECKs', count(*) = 6, count(*)::text || '/6'
  FROM pg_constraint WHERE conrelid = to_regclass('public.bookings') AND contype = 'c'
    AND conname IN ('bookings_commission_type_check', 'bookings_commission_mode_check',
      'bookings_commission_set_check', 'bookings_commission_value_check',
      'bookings_commission_within_fee_check', 'bookings_tax_note_check')
  UNION ALL
  SELECT 3, 'artists: default commission columns', count(*) = 4, count(*)::text || '/4'
  FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'artists'
    AND column_name IN ('default_commission_type', 'default_commission_value', 'default_commission_mode', 'default_commission_currency')
  UNION ALL
  SELECT 4, 'artists: default commission CHECKs', count(*) = 6, count(*)::text || '/6'
  FROM pg_constraint WHERE conrelid = to_regclass('public.artists') AND contype = 'c'
    AND conname LIKE 'artists\_default\_commission\_%'
  UNION ALL
  SELECT 5, 'booking_payments: table with 11 columns', count(*) = 11, count(*)::text || '/11'
  FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'booking_payments'
  UNION ALL
  SELECT 6, 'booking_payments: RLS enabled', coalesce(bool_and(relrowsecurity), false), coalesce(bool_and(relrowsecurity)::text, 'table absent')
  FROM pg_class WHERE oid = to_regclass('public.booking_payments')
  UNION ALL
  SELECT 7, 'booking_payments: one FOR ALL active-member policy for authenticated',
         count(*) = 1 AND bool_and(cmd = 'ALL' AND roles = '{authenticated}'
           AND qual LIKE '%backbeat_is_active_member(workspace_id)' AND with_check LIKE '%backbeat_is_active_member(workspace_id)'),
         coalesce(string_agg(policyname || ':' || cmd || ':' || array_to_string(roles, ','), ', '), 'none')
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'booking_payments'
  UNION ALL
  SELECT 8, 'booking_payments: authenticated has SELECT, INSERT, UPDATE but no effective DELETE or TRUNCATE',
         coalesce(string_agg(privilege_type, ',' ORDER BY privilege_type), '') = 'INSERT,SELECT,UPDATE'
           AND NOT has_table_privilege('authenticated', to_regclass('public.booking_payments'), 'DELETE, TRUNCATE'),
         coalesce(string_agg(privilege_type, ',' ORDER BY privilege_type), 'none')
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public' AND table_name = 'booking_payments' AND grantee = 'authenticated'
  UNION ALL
  SELECT 9, 'booking_payments: no grant to anon or PUBLIC', count(*) = 0, count(*)::text || ' grants'
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public' AND table_name = 'booking_payments' AND grantee IN ('anon', 'PUBLIC')
  UNION ALL
  SELECT 10, 'booking_payments: composite FK to bookings is ON DELETE RESTRICT',
         count(*) = 1 AND bool_and(confdeltype = 'r' AND confrelid = to_regclass('public.bookings')),
         coalesce(string_agg(pg_get_constraintdef(oid), ' '), 'absent')
  FROM pg_constraint WHERE conrelid = to_regclass('public.booking_payments') AND conname = 'booking_payments_booking_fkey'
  UNION ALL
  SELECT 11, 'booking_payments: UNIQUE (workspace_id, id) and CHECKs', count(*) = 5, count(*)::text || '/5'
  FROM pg_constraint WHERE conrelid = to_regclass('public.booking_payments')
    AND conname IN ('booking_payments_workspace_id_id_key', 'booking_payments_kind_check',
      'booking_payments_amount_minor_check', 'booking_payments_currency_check', 'booking_payments_note_check')
  UNION ALL
  SELECT 12, 'triggers: payment currency, payment updated_at, booking fee currency', count(*) = 3, count(*)::text || '/3'
  FROM pg_trigger WHERE NOT tgisinternal AND tgenabled = 'O' AND (
    (tgrelid = to_regclass('public.booking_payments') AND tgname IN ('booking_payments_enforce_currency', 'booking_payments_updated_at'))
    OR (tgrelid = to_regclass('public.bookings') AND tgname = 'bookings_enforce_fee_currency'))
  UNION ALL
  SELECT 13, 'trigger functions: SECURITY INVOKER, not executable by anon/authenticated',
         count(*) = 2 AND bool_and(NOT prosecdef AND NOT has_function_privilege('authenticated', oid, 'EXECUTE')
           AND NOT has_function_privilege('anon', oid, 'EXECUTE')), count(*)::text || '/2'
  FROM pg_proc WHERE pronamespace = 'public'::regnamespace
    AND proname IN ('backbeat_enforce_payment_currency', 'backbeat_enforce_booking_fee_currency')
  UNION ALL
  SELECT 14, 'bookings: policy set unchanged (booking_access:ALL)',
         coalesce(string_agg(policyname || ':' || cmd, ',' ORDER BY policyname), '') = 'booking_access:ALL',
         coalesce(string_agg(policyname || ':' || cmd, ',' ORDER BY policyname), 'none')
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'bookings'
  UNION ALL
  SELECT 15, 'payment history guard enabled and not exposed to API roles',
         count(*) = 1 AND bool_and(t.tgenabled = 'O' AND t.tgtype = 19 AND NOT f.prosecdef
           AND NOT has_function_privilege('anon', f.oid, 'EXECUTE')
           AND NOT has_function_privilege('authenticated', f.oid, 'EXECUTE')
           AND NOT has_function_privilege('service_role', f.oid, 'EXECUTE')),
         count(*)::text || '/1'
  FROM pg_trigger AS t JOIN pg_proc AS f ON f.oid = t.tgfoid
  WHERE NOT t.tgisinternal AND t.tgrelid = to_regclass('public.booking_payments')
    AND t.tgname = 'booking_payments_z_guard_history' AND f.pronamespace = 'public'::regnamespace
    AND f.proname = 'backbeat_guard_booking_payment_history'
)
SELECT ord, item, CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS result, detail FROM checks
UNION ALL
SELECT 99, 'SUMMARY', CASE WHEN bool_and(ok) THEN 'ALL PASS' ELSE 'FAILED' END,
       count(*) FILTER (WHERE ok)::text || '/' || count(*)::text FROM checks
ORDER BY ord;
