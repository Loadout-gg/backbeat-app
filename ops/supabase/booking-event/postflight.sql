-- Read-only postflight for migration 008 (booking -> event). One pure SELECT over the catalog.
-- Every row must say PASS; the last row is the summary (ALL PASS: n/n).
WITH checks(ord, item, ok, detail) AS (
  SELECT 1, 'events: booking link, start time and fee columns', count(*) = 4, count(*)::text || '/4'
  FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'events'
    AND ((column_name = 'booking_id' AND data_type = 'uuid')
      OR (column_name = 'start_time' AND data_type = 'time without time zone')
      OR (column_name = 'fee_amount_minor' AND data_type = 'bigint')
      OR (column_name = 'fee_currency' AND data_type = 'text'))
    AND is_nullable = 'YES'
  UNION ALL
  SELECT 2, 'events: status CHECK allows exactly in_progress, confirmed, cancelled',
         count(*) = 1 AND bool_and(pg_get_constraintdef(oid) LIKE '%in_progress%'
           AND pg_get_constraintdef(oid) LIKE '%confirmed%' AND pg_get_constraintdef(oid) LIKE '%cancelled%'
           AND pg_get_constraintdef(oid) NOT LIKE '%completed%'),
         coalesce(string_agg(pg_get_constraintdef(oid), ' '), 'absent')
  FROM pg_constraint WHERE conrelid = to_regclass('public.events') AND contype = 'c' AND conname = 'events_status_check'
  UNION ALL
  SELECT 3, 'events: no row outside the status CHECK', count(*) = 0, count(*)::text || ' rows'
  FROM public.events WHERE status IS NULL OR status NOT IN ('in_progress', 'confirmed', 'cancelled')
  UNION ALL
  SELECT 4, 'events: fee CHECKs (amount range, currency list, pair)', count(*) = 3, count(*)::text || '/3'
  FROM pg_constraint WHERE conrelid = to_regclass('public.events') AND contype = 'c'
    AND conname IN ('events_fee_amount_minor_check', 'events_fee_currency_check', 'events_fee_pair_check')
  UNION ALL
  SELECT 5, 'events: UNIQUE (workspace_id, id)', count(*) >= 1, count(*)::text
  FROM pg_constraint con WHERE con.conrelid = to_regclass('public.events') AND con.contype IN ('u', 'p')
    AND (SELECT array_agg(att.attname::text ORDER BY att.attname::text)
         FROM unnest(con.conkey) k JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = k)
        = ARRAY['id', 'workspace_id']
  UNION ALL
  SELECT 6, 'events: UNIQUE (booking_id), one event per booking',
         count(*) = 1 AND bool_and(contype = 'u' AND pg_get_constraintdef(oid) = 'UNIQUE (booking_id)'),
         coalesce(string_agg(pg_get_constraintdef(oid), ' '), 'absent')
  FROM pg_constraint WHERE conrelid = to_regclass('public.events') AND conname = 'events_booking_id_key'
  UNION ALL
  SELECT 7, 'events: composite FK to bookings, ON DELETE SET NULL (booking_id) only',
         count(*) = 1 AND bool_and(confrelid = to_regclass('public.bookings') AND confdeltype = 'n'
           AND pg_get_constraintdef(oid) LIKE 'FOREIGN KEY (workspace_id, booking_id) REFERENCES bookings(workspace_id, id) ON DELETE SET NULL (booking_id)%'),
         coalesce(string_agg(pg_get_constraintdef(oid), ' '), 'absent')
  FROM pg_constraint WHERE conrelid = to_regclass('public.events') AND conname = 'events_booking_id_fkey'
  UNION ALL
  SELECT 8, 'bookings: promoter_id uuid, nullable', count(*) = 1, count(*)::text || '/1'
  FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'bookings'
    AND column_name = 'promoter_id' AND data_type = 'uuid' AND is_nullable = 'YES'
  UNION ALL
  SELECT 9, 'bookings: composite FK to promoters, ON DELETE SET NULL (promoter_id) only',
         count(*) = 1 AND bool_and(confrelid = to_regclass('public.promoters') AND confdeltype = 'n'
           AND pg_get_constraintdef(oid) LIKE 'FOREIGN KEY (workspace_id, promoter_id) REFERENCES promoters(workspace_id, id) ON DELETE SET NULL (promoter_id)%'),
         coalesce(string_agg(pg_get_constraintdef(oid), ' '), 'absent')
  FROM pg_constraint WHERE conrelid = to_regclass('public.bookings') AND conname = 'bookings_promoter_id_fkey'
  UNION ALL
  SELECT 10, 'bookings: index on (workspace_id, promoter_id)', count(*) = 1, count(*)::text || '/1'
  FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'bookings' AND indexname = 'bookings_workspace_promoter_idx'
  UNION ALL
  SELECT 11, 'RLS still enabled on events, bookings, promoters', count(*) = 3, count(*)::text || '/3'
  FROM pg_class WHERE relrowsecurity
    AND oid IN (to_regclass('public.events'), to_regclass('public.bookings'), to_regclass('public.promoters'))
  UNION ALL
  -- 008 creates, drops and alters no policy and no grant. These two rows are information to
  -- compare with the preflight output (sections "policy" and "grant"); they never fail.
  SELECT 12, 'info: policies on events, bookings, promoters (compare with preflight)', true,
         coalesce(string_agg(tablename || '.' || policyname || ':' || cmd || ':' || array_to_string(roles, '+'), ', '
           ORDER BY tablename, policyname), 'none')
  FROM pg_policies WHERE schemaname = 'public' AND tablename IN ('events', 'bookings', 'promoters')
  UNION ALL
  SELECT 13, 'info: table privileges of anon/PUBLIC on events, bookings, promoters (compare with preflight)', true,
         count(*)::text || ' grants'
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public' AND table_name IN ('events', 'bookings', 'promoters') AND grantee IN ('anon', 'PUBLIC')
  UNION ALL
  SELECT 14, 'no backfill: no event is linked to a booking or carries a snapshot, no booking has a promoter (first apply only)',
         true, (SELECT count(*)::text FROM public.events WHERE booking_id IS NOT NULL OR start_time IS NOT NULL OR fee_amount_minor IS NOT NULL)
           || ' events, ' || (SELECT count(*)::text FROM public.bookings WHERE promoter_id IS NOT NULL) || ' bookings'
)
SELECT ord, item, CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS result, detail FROM checks
UNION ALL
SELECT 99, 'SUMMARY', CASE WHEN bool_and(ok) THEN 'ALL PASS' ELSE 'FAILED' END,
       count(*) FILTER (WHERE ok)::text || '/' || count(*)::text FROM checks
ORDER BY ord;
