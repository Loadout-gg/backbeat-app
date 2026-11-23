-- Post-apply verification for migration 009, for the staging SQL editor (one paste).
-- Acts as two real users through the authenticated role: an active member of one booking's
-- workspace, and a user who is not a member of that workspace. Needs one booking whose workspace
-- has an active member (create it in the app first) and a second account in another workspace;
-- otherwise the affected checks report SKIP.
--
-- Every write happens inside a block that is always rolled back: no row is changed and nothing
-- is left behind. Only synthetic marker values are written ('BB-VERIFY-...').
-- OUTPUT: the final SELECT. First row: "BOOKING_TRAVEL_VERIFY ALL PASS: pass=13 fail=0 skip=0".
-- "FAILED" or "INCOMPLETE" there means do not merge.
DO $verify$
DECLARE
  target record;
  member uuid;
  outsider uuid;
  results text[] := ARRAY[]::text[];
  outcome text;
  affected bigint;
  leg uuid;
  stay uuid;
  doc uuid;
BEGIN
  SELECT b.id, b.workspace_id, b.artist_id, b.date INTO target
    FROM public.bookings AS b
    WHERE EXISTS (SELECT 1 FROM public.workspace_members AS m
      WHERE m.workspace_id = b.workspace_id AND m.status = 'active')
    ORDER BY b.created_at DESC, b.id LIMIT 1;
  IF target.id IS NOT NULL THEN
    SELECT m.user_id INTO member FROM public.workspace_members AS m
      WHERE m.workspace_id = target.workspace_id AND m.status = 'active' LIMIT 1;
    SELECT u.id INTO outsider FROM auth.users AS u
      WHERE NOT EXISTS (SELECT 1 FROM public.workspace_members AS m
        WHERE m.workspace_id = target.workspace_id AND m.user_id = u.id) LIMIT 1;
  END IF;

  BEGIN
    IF target.id IS NULL OR member IS NULL THEN
      results := results || 'SKIP|all|no booking with an active member; create one in the app'::text;
      RAISE EXCEPTION 'BB_VERIFY_ROLLBACK';
    END IF;

    -- Member: create one row in each table through the API role.
    PERFORM set_config('request.jwt.claim.sub', member::text, true);
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', member, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    BEGIN
      INSERT INTO public.booking_travel_legs (workspace_id, booking_id, direction, mode,
        depart_place, depart_date, depart_time, arrive_place, arrive_date, arrive_time, driver_name)
        VALUES (target.workspace_id, target.id, 'inbound', 'flight', 'BB-VERIFY-A', target.date,
          '08:00', 'BB-VERIFY-B', target.date, '10:00', 'BB-VERIFY-DRIVER') RETURNING id INTO leg;
      INSERT INTO public.booking_stays (workspace_id, booking_id, name, check_in_on, check_out_on)
        VALUES (target.workspace_id, target.id, 'BB-VERIFY-HOTEL', target.date, target.date + 1)
        RETURNING id INTO stay;
      INSERT INTO public.artist_travel_documents (workspace_id, artist_id, doc_type, number)
        VALUES (target.workspace_id, target.artist_id, 'passport', 'BB-VERIFY-0000') RETURNING id INTO doc;
      outcome := 'ok';
    EXCEPTION WHEN OTHERS THEN outcome := SQLSTATE;
    END;
    results := results || (CASE WHEN outcome = 'ok' THEN 'PASS' ELSE 'FAIL' END
      || '|member: creates a leg, a stay and a travel document|' || outcome);
    IF outcome <> 'ok' THEN RAISE EXCEPTION 'BB_VERIFY_ROLLBACK'; END IF;

    SELECT (SELECT count(*) FROM public.booking_travel_legs WHERE id = leg)
         + (SELECT count(*) FROM public.booking_stays WHERE id = stay)
         + (SELECT count(*) FROM public.artist_travel_documents WHERE id = doc) INTO affected;
    results := results || (CASE WHEN affected = 3 THEN 'PASS' ELSE 'FAIL' END
      || '|member: reads the three rows|visible rows=' || affected);

    UPDATE public.booking_travel_legs SET notes = 'BB-VERIFY-NOTE' WHERE id = leg;
    GET DIAGNOSTICS affected = ROW_COUNT;
    results := results || (CASE WHEN affected = 1 THEN 'PASS' ELSE 'FAIL' END
      || '|member: updates a leg|rows changed=' || affected);

    BEGIN
      UPDATE public.booking_travel_legs SET booking_id = gen_random_uuid() WHERE id = leg;
      outcome := 'updated';
    EXCEPTION WHEN OTHERS THEN outcome := SQLSTATE;
    END;
    results := results || (CASE WHEN outcome = '42501' THEN 'PASS' ELSE 'FAIL' END
      || '|member: cannot move a leg to another booking|' || outcome || ' (expected 42501)');

    BEGIN
      UPDATE public.booking_travel_legs SET arrive_date = target.date - 1 WHERE id = leg;
      outcome := 'updated';
    EXCEPTION WHEN OTHERS THEN outcome := SQLSTATE;
    END;
    results := results || (CASE WHEN outcome = '23514' THEN 'PASS' ELSE 'FAIL' END
      || '|leg: arrival before departure rejected|' || outcome || ' (expected 23514)');

    BEGIN
      UPDATE public.booking_travel_legs SET depart_zone = 'BB-VERIFY-JST', arrive_zone = 'BB-VERIFY-PST',
        arrive_date = target.date - 1 WHERE id = leg;
      GET DIAGNOSTICS affected = ROW_COUNT;
      outcome := 'rows=' || affected;
    EXCEPTION WHEN OTHERS THEN outcome := SQLSTATE;
    END;
    results := results || (CASE WHEN outcome = 'rows=1' THEN 'PASS' ELSE 'FAIL' END
      || '|leg: date-line arrival one day earlier accepted with different zone labels|' || outcome || ' (expected rows=1)');

    BEGIN
      UPDATE public.booking_stays SET check_out_on = target.date - 1 WHERE id = stay;
      outcome := 'updated';
    EXCEPTION WHEN OTHERS THEN outcome := SQLSTATE;
    END;
    results := results || (CASE WHEN outcome = '23514' THEN 'PASS' ELSE 'FAIL' END
      || '|stay: check-out before check-in rejected|' || outcome || ' (expected 23514)');
    RESET ROLE;

    -- Outsider: must neither see nor change nor add rows of the workspace.
    IF outsider IS NULL THEN
      results := results || 'SKIP|rls: outsider|no user outside the booking workspace; sign up a second account'::text;
    ELSE
      PERFORM set_config('request.jwt.claim.sub', outsider::text, true);
      PERFORM set_config('request.jwt.claims',
        json_build_object('sub', outsider, 'role', 'authenticated')::text, true);
      SET LOCAL ROLE authenticated;
      SELECT (SELECT count(*) FROM public.booking_travel_legs WHERE workspace_id = target.workspace_id)
           + (SELECT count(*) FROM public.booking_stays WHERE workspace_id = target.workspace_id)
           + (SELECT count(*) FROM public.artist_travel_documents WHERE workspace_id = target.workspace_id)
        INTO affected;
      results := results || (CASE WHEN affected = 0 THEN 'PASS' ELSE 'FAIL' END
        || '|rls: outsider sees no travel, stay or document row|visible rows=' || affected);
      UPDATE public.artist_travel_documents SET number = 'BB-VERIFY-X' WHERE id = doc;
      GET DIAGNOSTICS affected = ROW_COUNT;
      results := results || (CASE WHEN affected = 0 THEN 'PASS' ELSE 'FAIL' END
        || '|rls: outsider cannot change a travel document|rows changed=' || affected);
      DELETE FROM public.booking_stays WHERE id = stay;
      GET DIAGNOSTICS affected = ROW_COUNT;
      results := results || (CASE WHEN affected = 0 THEN 'PASS' ELSE 'FAIL' END
        || '|rls: outsider cannot delete a stay|rows deleted=' || affected);
      BEGIN
        INSERT INTO public.booking_travel_legs (workspace_id, booking_id, direction)
          VALUES (target.workspace_id, target.id, 'other');
        outcome := 'inserted';
      EXCEPTION WHEN OTHERS THEN outcome := SQLSTATE;
      END;
      results := results || (CASE WHEN outcome = '42501' THEN 'PASS' ELSE 'FAIL' END
        || '|rls: outsider cannot add a leg to the workspace|' || outcome || ' (expected 42501)');
      RESET ROLE;
    END IF;

    -- Cascades, as the member: deleting the booking removes its legs and stays; deleting the
    -- artist removes the travel documents. Rolled back with everything else.
    PERFORM set_config('request.jwt.claim.sub', member::text, true);
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', member, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    DELETE FROM public.bookings WHERE id = target.id;
    SELECT (SELECT count(*) FROM public.booking_travel_legs WHERE id = leg)
         + (SELECT count(*) FROM public.booking_stays WHERE id = stay) INTO affected;
    results := results || (CASE WHEN affected = 0 THEN 'PASS' ELSE 'FAIL' END
      || '|cascade: booking delete removes its legs and stays|remaining rows=' || affected);
    DELETE FROM public.artists WHERE id = target.artist_id;
    SELECT count(*) INTO affected FROM public.artist_travel_documents WHERE id = doc;
    results := results || (CASE WHEN affected = 0 THEN 'PASS' ELSE 'FAIL' END
      || '|cascade: artist delete removes its travel documents|remaining rows=' || affected);
    RESET ROLE;
    RAISE EXCEPTION 'BB_VERIFY_ROLLBACK';
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    IF SQLERRM <> 'BB_VERIFY_ROLLBACK' THEN
      results := results || ('FAIL|verification aborted|' || SQLSTATE);
    END IF;
  END;

  -- The SQL editor shows only the last statement's result: keep the report in a session
  -- setting (no table is created) and read it with the final SELECT below.
  PERFORM set_config('backbeat.booking_travel_verify', (
    SELECT format('BOOKING_TRAVEL_VERIFY %s: pass=%s fail=%s skip=%s',
      CASE WHEN bool_or(line LIKE 'FAIL|%') THEN 'FAILED'
           WHEN bool_or(line LIKE 'SKIP|%') THEN 'INCOMPLETE'
           ELSE 'ALL PASS' END,
      count(*) FILTER (WHERE line LIKE 'PASS|%'),
      count(*) FILTER (WHERE line LIKE 'FAIL|%'),
      count(*) FILTER (WHERE line LIKE 'SKIP|%'))
      || E'\n' || string_agg(ordinality || '. ' || replace(line, '|', ' | '), E'\n' ORDER BY ordinality)
    FROM unnest(results) WITH ORDINALITY AS r(line, ordinality)), false);
END
$verify$;
SELECT ordinality - 1 AS line_no, line AS result
FROM unnest(string_to_array(current_setting('backbeat.booking_travel_verify', true), E'\n'))
  WITH ORDINALITY AS r(line, ordinality)
ORDER BY ordinality;
