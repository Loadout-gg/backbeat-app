-- Post-apply verification for migration 008, for the staging SQL editor (one paste).
-- Acts through the authenticated role as two real users: an active member of one artist's
-- workspace and a user who is not a member of it, plus the anon role.
-- Needs one artist in a workspace with an active member, and one account outside that
-- workspace; otherwise the affected checks report SKIP.
-- It creates its own booking, promoter, event and a second workspace inside a block that is
-- always rolled back: no row is changed and nothing is left behind. The report is the
-- result of the final SELECT:
--   first row "SUMMARY | ALL PASS | pass=16 fail=0 skip=0", then one row per check.
-- "FAILED" or "INCOMPLETE" in the summary means do not merge.
DO $verify$
DECLARE
  target record;
  member uuid;
  outsider uuid;
  booking uuid;
  promoter uuid;
  event uuid;
  other_workspace uuid;
  other_booking uuid;
  other_promoter uuid;
  results text[] := ARRAY[]::text[];
  outcome text;
  affected bigint;
BEGIN
  PERFORM set_config('backbeat.event_verify_report', '', false);
  SELECT a.id AS artist_id, a.workspace_id INTO target
    FROM public.artists AS a
    WHERE EXISTS (SELECT 1 FROM public.workspace_members AS m
        WHERE m.workspace_id = a.workspace_id AND m.status = 'active')
    ORDER BY a.created_at DESC, a.id LIMIT 1;
  IF target.artist_id IS NOT NULL THEN
    SELECT m.user_id INTO member FROM public.workspace_members AS m
      WHERE m.workspace_id = target.workspace_id AND m.status = 'active'
      ORDER BY m.user_id LIMIT 1;
    SELECT u.id INTO outsider FROM auth.users AS u
      WHERE NOT EXISTS (SELECT 1 FROM public.workspace_members AS m
        WHERE m.workspace_id = target.workspace_id AND m.user_id = u.id)
      ORDER BY u.id LIMIT 1;
  END IF;

  BEGIN
    IF target.artist_id IS NULL OR member IS NULL THEN
      results := results || 'SKIP|all|no artist in a workspace with an active member; create one in the app'::text;
      RAISE EXCEPTION 'BB_VERIFY_ROLLBACK';
    END IF;

    -- A second workspace with its own booking and promoter, as the database owner, for the
    -- cross-workspace checks. Rolled back with everything else.
    BEGIN
      INSERT INTO public.workspaces (name) VALUES ('BB VERIFY other workspace') RETURNING id INTO other_workspace;
      INSERT INTO public.artists (workspace_id, name) VALUES (other_workspace, 'BB VERIFY other artist');
      INSERT INTO public.bookings (workspace_id, artist_id, date, start_time)
        SELECT other_workspace, a.id, CURRENT_DATE + 30, '20:00' FROM public.artists AS a
        WHERE a.workspace_id = other_workspace
        RETURNING id INTO other_booking;
      INSERT INTO public.promoters (workspace_id, name) VALUES (other_workspace, 'BB VERIFY other promoter')
        RETURNING id INTO other_promoter;
    EXCEPTION WHEN OTHERS THEN
      other_booking := NULL; other_promoter := NULL;
      outcome := SQLSTATE;
    END;

    -- Member: same role and claims the API uses.
    PERFORM set_config('request.jwt.claim.sub', member::text, true);
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', member, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;

    INSERT INTO public.bookings (workspace_id, artist_id, date, start_time)
      VALUES (target.workspace_id, target.artist_id, CURRENT_DATE + 30, '20:00') RETURNING id INTO booking;
    INSERT INTO public.promoters (workspace_id, name) VALUES (target.workspace_id, 'BB VERIFY promoter')
      RETURNING id INTO promoter;

    UPDATE public.bookings SET promoter_id = promoter WHERE id = booking;
    GET DIAGNOSTICS affected = ROW_COUNT;
    results := results || (CASE WHEN affected = 1 THEN 'PASS' ELSE 'FAIL' END
      || '|member: links a promoter of the workspace to a booking|rows=' || affected);
    BEGIN
      UPDATE public.bookings SET promoter_id = gen_random_uuid() WHERE id = booking;
      outcome := 'updated';
    EXCEPTION WHEN OTHERS THEN outcome := SQLSTATE;
    END;
    results := results || (CASE WHEN outcome = '23503' THEN 'PASS' ELSE 'FAIL' END
      || '|member: unknown promoter rejected|' || outcome || ' (expected 23503)');
    IF other_promoter IS NULL THEN
      results := results || 'SKIP|member: promoter of another workspace rejected|could not create the second workspace'::text;
    ELSE
      BEGIN
        UPDATE public.bookings SET promoter_id = other_promoter WHERE id = booking;
        outcome := 'updated';
      EXCEPTION WHEN OTHERS THEN outcome := SQLSTATE;
      END;
      results := results || (CASE WHEN outcome = '23503' THEN 'PASS' ELSE 'FAIL' END
        || '|member: promoter of another workspace rejected|' || outcome || ' (expected 23503)');
    END IF;

    BEGIN
      INSERT INTO public.events (workspace_id, title, date, location, status, artist_id, promoter_id,
          booking_id, start_time, fee_amount_minor, fee_currency)
        VALUES (target.workspace_id, 'BB VERIFY event', CURRENT_DATE + 30, 'BB VERIFY venue', 'confirmed',
          target.artist_id, promoter, booking, '20:00', 150000, 'EUR')
        RETURNING id INTO event;
      outcome := 'inserted';
    EXCEPTION WHEN OTHERS THEN outcome := SQLSTATE;
    END;
    results := results || (CASE WHEN outcome = 'inserted' THEN 'PASS' ELSE 'FAIL' END
      || '|member: creates the event linked to the booking, with start time and fee|' || outcome);
    BEGIN
      INSERT INTO public.events (workspace_id, title, date, status, booking_id)
        VALUES (target.workspace_id, 'BB VERIFY second event', CURRENT_DATE + 30, 'confirmed', booking);
      outcome := 'inserted';
    EXCEPTION WHEN OTHERS THEN outcome := SQLSTATE;
    END;
    results := results || (CASE WHEN outcome = '23505' THEN 'PASS' ELSE 'FAIL' END
      || '|member: a second event for the same booking is rejected|' || outcome || ' (expected 23505)');
    BEGIN
      INSERT INTO public.events (workspace_id, title, date, status, booking_id)
        VALUES (target.workspace_id, 'BB VERIFY orphan event', CURRENT_DATE + 30, 'confirmed', gen_random_uuid());
      outcome := 'inserted';
    EXCEPTION WHEN OTHERS THEN outcome := SQLSTATE;
    END;
    results := results || (CASE WHEN outcome = '23503' THEN 'PASS' ELSE 'FAIL' END
      || '|member: event for an unknown booking rejected|' || outcome || ' (expected 23503)');
    IF other_booking IS NULL THEN
      results := results || 'SKIP|member: event for a booking of another workspace rejected|could not create the second workspace'::text;
    ELSE
      BEGIN
        INSERT INTO public.events (workspace_id, title, date, status, booking_id)
          VALUES (target.workspace_id, 'BB VERIFY cross event', CURRENT_DATE + 30, 'confirmed', other_booking);
        outcome := 'inserted';
      EXCEPTION WHEN OTHERS THEN outcome := SQLSTATE;
      END;
      results := results || (CASE WHEN outcome = '23503' THEN 'PASS' ELSE 'FAIL' END
        || '|member: event for a booking of another workspace rejected|' || outcome || ' (expected 23503)');
    END IF;
    BEGIN
      INSERT INTO public.events (workspace_id, title, date, status)
        VALUES (target.workspace_id, 'BB VERIFY status event', CURRENT_DATE + 30, 'completed');
      outcome := 'inserted';
    EXCEPTION WHEN OTHERS THEN outcome := SQLSTATE;
    END;
    results := results || (CASE WHEN outcome = '23514' THEN 'PASS' ELSE 'FAIL' END
      || '|member: event status outside in_progress/confirmed/cancelled rejected|' || outcome || ' (expected 23514)');
    BEGIN
      INSERT INTO public.events (workspace_id, title, date, status, fee_amount_minor)
        VALUES (target.workspace_id, 'BB VERIFY fee event', CURRENT_DATE + 30, 'confirmed', 1000);
      outcome := 'inserted';
    EXCEPTION WHEN OTHERS THEN outcome := SQLSTATE;
    END;
    results := results || (CASE WHEN outcome = '23514' THEN 'PASS' ELSE 'FAIL' END
      || '|member: event fee amount without currency rejected|' || outcome || ' (expected 23514)');
    RESET ROLE;

    -- Outsider: must neither see nor change the event or the booking.
    IF outsider IS NULL OR event IS NULL THEN
      results := results || ('SKIP|outsider: cannot see, change or insert|'
        || CASE WHEN outsider IS NULL THEN 'no user outside the workspace; sign up a second account'
                ELSE 'the linked event was not created' END);
    ELSE
      PERFORM set_config('request.jwt.claim.sub', outsider::text, true);
      PERFORM set_config('request.jwt.claims',
        json_build_object('sub', outsider, 'role', 'authenticated')::text, true);
      SET LOCAL ROLE authenticated;
      SELECT count(*) INTO affected FROM public.events WHERE workspace_id = target.workspace_id;
      results := results || (CASE WHEN affected = 0 THEN 'PASS' ELSE 'FAIL' END
        || '|outsider: sees no event of the workspace|visible rows=' || affected);
      UPDATE public.events SET booking_id = NULL, fee_amount_minor = 1, fee_currency = 'USD' WHERE id = event;
      GET DIAGNOSTICS affected = ROW_COUNT;
      results := results || (CASE WHEN affected = 0 THEN 'PASS' ELSE 'FAIL' END
        || '|outsider: cannot unlink or change the event|rows changed=' || affected);
      UPDATE public.bookings SET promoter_id = NULL WHERE id = booking;
      GET DIAGNOSTICS affected = ROW_COUNT;
      results := results || (CASE WHEN affected = 0 THEN 'PASS' ELSE 'FAIL' END
        || '|outsider: cannot change the booking promoter|rows changed=' || affected);
      BEGIN
        INSERT INTO public.events (workspace_id, title, date, status, booking_id)
          VALUES (target.workspace_id, 'BB VERIFY outsider event', CURRENT_DATE + 30, 'confirmed', NULL);
        outcome := 'inserted';
      EXCEPTION WHEN OTHERS THEN outcome := SQLSTATE;
      END;
      results := results || (CASE WHEN outcome = '42501' THEN 'PASS' ELSE 'FAIL' END
        || '|outsider: cannot insert an event into the workspace|' || outcome || ' (expected 42501)');
      RESET ROLE;
    END IF;

    -- Anon: no row, whether through a missing grant (42501) or through RLS (0 rows).
    PERFORM set_config('request.jwt.claim.sub', '', true);
    PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
    SET LOCAL ROLE anon;
    BEGIN
      SELECT count(*) INTO affected FROM public.events;
      outcome := 'rows=' || affected;
    EXCEPTION WHEN OTHERS THEN outcome := SQLSTATE;
    END;
    RESET ROLE;
    results := results || (CASE WHEN outcome IN ('rows=0', '42501') THEN 'PASS' ELSE 'FAIL' END
      || '|anon: sees no event|' || outcome || ' (expected rows=0 or 42501)');

    -- Member again: deleting the promoter, then the booking, keeps the event.
    PERFORM set_config('request.jwt.claim.sub', member::text, true);
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', member, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    BEGIN
      DELETE FROM public.promoters WHERE id = promoter;
      SELECT CASE WHEN b.promoter_id IS NULL AND b.workspace_id = target.workspace_id
                    AND (SELECT e.promoter_id IS NULL AND e.booking_id = booking FROM public.events AS e WHERE e.id = event)
                  THEN 'ok' ELSE 'unexpected row state' END
        INTO outcome FROM public.bookings AS b WHERE b.id = booking;
      outcome := coalesce(outcome, 'booking gone');
    EXCEPTION WHEN OTHERS THEN outcome := SQLSTATE;
    END;
    results := results || (CASE WHEN outcome = 'ok' THEN 'PASS' ELSE 'FAIL' END
      || '|member: deleting the promoter keeps booking and event, only the promoter link is cleared|' || outcome);
    BEGIN
      DELETE FROM public.bookings WHERE id = booking;
      SELECT CASE WHEN e.booking_id IS NULL AND e.workspace_id = target.workspace_id
                    AND e.title = 'BB VERIFY event' AND e.fee_amount_minor = 150000 AND e.start_time = '20:00'
                  THEN 'ok' ELSE 'unexpected row state' END
        INTO outcome FROM public.events AS e WHERE e.id = event;
      outcome := coalesce(outcome, 'event gone');
    EXCEPTION WHEN OTHERS THEN outcome := SQLSTATE;
    END;
    results := results || (CASE WHEN outcome = 'ok' THEN 'PASS' ELSE 'FAIL' END
      || '|member: deleting the booking keeps the event, only booking_id is cleared|' || outcome);
    RESET ROLE;
    RAISE EXCEPTION 'BB_VERIFY_ROLLBACK';
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    IF SQLERRM <> 'BB_VERIFY_ROLLBACK' THEN
      results := results || ('FAIL|verification aborted|' || SQLSTATE || ' ' || SQLERRM);
    END IF;
  END;

  -- Everything above is rolled back. The report leaves the block through a session setting,
  -- because the SQL editor shows only the result of the last statement.
  PERFORM set_config('backbeat.event_verify_report', array_to_string(results, E'\n'), false);
END
$verify$;
WITH lines AS (
  SELECT ordinality AS ord, split_part(line, '|', 1) AS result,
         split_part(line, '|', 2) AS item, split_part(line, '|', 3) AS detail
  FROM unnest(string_to_array(nullif(current_setting('backbeat.event_verify_report', true), ''), E'\n'))
    WITH ORDINALITY AS r(line, ordinality)
)
SELECT 0 AS ord, 'SUMMARY' AS item,
       CASE WHEN count(*) = 0 OR count(*) FILTER (WHERE result = 'FAIL') > 0 THEN 'FAILED'
            WHEN count(*) FILTER (WHERE result = 'SKIP') > 0 THEN 'INCOMPLETE'
            ELSE 'ALL PASS' END AS result,
       'pass=' || count(*) FILTER (WHERE result = 'PASS') || ' fail=' || count(*) FILTER (WHERE result = 'FAIL')
         || ' skip=' || count(*) FILTER (WHERE result = 'SKIP') AS detail
FROM lines
UNION ALL
SELECT ord, item, result, detail FROM lines
ORDER BY ord;
