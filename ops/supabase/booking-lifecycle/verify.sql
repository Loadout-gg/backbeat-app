-- Post-apply verification for migration 006, for the staging SQL editor (run as one paste).
-- Acts as two real users through the authenticated role: an active member of one
-- in_progress booking's workspace, and a user who is not a member of that workspace.
-- Every write happens inside a block that is always rolled back: no row is changed.
-- Needs one in_progress booking (create it in the app first) and a second account in
-- another workspace; otherwise the affected checks report SKIP.
-- Output: one row per check with result PASS, FAIL or SKIP.
DO $verify$
DECLARE
  target record;
  member uuid;
  outsider uuid;
  results text[] := ARRAY[]::text[];
  outcome text;
  affected bigint;
BEGIN
  SELECT b.id, b.workspace_id, b.artist_id, b.date INTO target
    FROM public.bookings AS b WHERE b.status = 'in_progress' ORDER BY b.created_at LIMIT 1;
  IF target.id IS NOT NULL THEN
    SELECT m.user_id INTO member FROM public.workspace_members AS m
      WHERE m.workspace_id = target.workspace_id AND m.status = 'active' LIMIT 1;
    SELECT u.id INTO outsider FROM auth.users AS u
      WHERE NOT EXISTS (SELECT 1 FROM public.workspace_members AS m
        WHERE m.workspace_id = target.workspace_id AND m.user_id = u.id) LIMIT 1;
  END IF;

  BEGIN
    IF target.id IS NULL OR member IS NULL THEN
      results := results || 'SKIP|all|no in_progress booking with an active member; create one in the app'::text;
      RAISE EXCEPTION 'BB_VERIFY_ROLLBACK';
    END IF;

    -- Outsider: must neither see nor change the booking.
    IF outsider IS NULL THEN
      results := results || 'SKIP|rls: outsider|no user outside the booking workspace; sign up a second account'::text;
    ELSE
      PERFORM set_config('request.jwt.claim.sub', outsider::text, true);
      PERFORM set_config('request.jwt.claims',
        json_build_object('sub', outsider, 'role', 'authenticated')::text, true);
      SET LOCAL ROLE authenticated;
      SELECT count(*) INTO affected FROM public.bookings WHERE workspace_id = target.workspace_id;
      results := results || (CASE WHEN affected = 0 THEN 'PASS' ELSE 'FAIL' END
        || '|rls: outsider sees no booking of the workspace|visible rows=' || affected);
      UPDATE public.bookings SET status = 'confirmed' WHERE id = target.id;
      GET DIAGNOSTICS affected = ROW_COUNT;
      results := results || (CASE WHEN affected = 0 THEN 'PASS' ELSE 'FAIL' END
        || '|rls: outsider cannot change status|rows changed=' || affected);
      BEGIN
        INSERT INTO public.bookings (workspace_id, artist_id, date, start_time)
          VALUES (target.workspace_id, target.artist_id, target.date, '20:00');
        outcome := 'inserted';
      EXCEPTION WHEN OTHERS THEN outcome := SQLSTATE;
      END;
      results := results || (CASE WHEN outcome = '42501' THEN 'PASS' ELSE 'FAIL' END
        || '|rls: outsider cannot insert into the workspace|' || outcome || ' (expected 42501)');
      RESET ROLE;
    END IF;

    -- Member: graph, insert rule and hold expiry through the same role the API uses.
    PERFORM set_config('request.jwt.claim.sub', member::text, true);
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', member, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO affected FROM public.bookings WHERE id = target.id;
    results := results || (CASE WHEN affected = 1 THEN 'PASS' ELSE 'FAIL' END
      || '|rls: member sees the booking|visible rows=' || affected);
    BEGIN
      UPDATE public.bookings SET status = 'completed' WHERE id = target.id;
      outcome := 'updated';
    EXCEPTION WHEN OTHERS THEN outcome := SQLSTATE;
    END;
    results := results || (CASE WHEN outcome = 'BB002' THEN 'PASS' ELSE 'FAIL' END
      || '|graph: in_progress -> completed rejected|' || outcome || ' (expected BB002)');
    BEGIN
      INSERT INTO public.bookings (workspace_id, artist_id, date, start_time, status)
        VALUES (target.workspace_id, target.artist_id, target.date, '20:00', 'confirmed');
      outcome := 'inserted';
    EXCEPTION WHEN OTHERS THEN outcome := SQLSTATE;
    END;
    results := results || (CASE WHEN outcome = 'BB001' THEN 'PASS' ELSE 'FAIL' END
      || '|insert: status other than in_progress rejected|' || outcome || ' (expected BB001)');
    BEGIN
      UPDATE public.bookings SET hold_expires_on = CURRENT_DATE WHERE id = target.id;
      outcome := 'updated';
    EXCEPTION WHEN OTHERS THEN outcome := SQLSTATE;
    END;
    results := results || (CASE WHEN outcome = '23514' THEN 'PASS' ELSE 'FAIL' END
      || '|hold expiry: rejected outside hold|' || outcome || ' (expected 23514)');
    BEGIN
      UPDATE public.bookings SET status = 'hold', hold_expires_on = CURRENT_DATE WHERE id = target.id;
      UPDATE public.bookings SET notes = notes WHERE id = target.id;
      UPDATE public.bookings SET status = 'option' WHERE id = target.id;
      SELECT CASE WHEN status = 'option' AND hold_expires_on IS NULL THEN 'ok' ELSE 'unexpected row state' END
        INTO outcome FROM public.bookings WHERE id = target.id;
      UPDATE public.bookings SET status = 'confirmed' WHERE id = target.id;
    EXCEPTION WHEN OTHERS THEN outcome := SQLSTATE;
    END;
    results := results || (CASE WHEN outcome = 'ok' THEN 'PASS' ELSE 'FAIL' END
      || '|graph: in_progress -> hold -> option -> confirmed, expiry cleared|' || outcome);
    IF target.date > CURRENT_DATE + 1 THEN
      BEGIN
        UPDATE public.bookings SET status = 'completed' WHERE id = target.id;
        outcome := 'updated';
      EXCEPTION WHEN OTHERS THEN outcome := SQLSTATE;
      END;
      results := results || (CASE WHEN outcome = 'BB003' THEN 'PASS' ELSE 'FAIL' END
        || '|completed: rejected before the show date|' || outcome || ' (expected BB003)');
    ELSE
      results := results || 'SKIP|completed: rejected before the show date|booking date is not in the future'::text;
    END IF;
    RESET ROLE;
    RAISE EXCEPTION 'BB_VERIFY_ROLLBACK';
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    IF SQLERRM <> 'BB_VERIFY_ROLLBACK' THEN
      results := results || ('FAIL|verification aborted|' || SQLSTATE || ' ' || SQLERRM);
    END IF;
  END;

  DROP TABLE IF EXISTS pg_temp.bb_lifecycle_verify;
  CREATE TEMP TABLE bb_lifecycle_verify AS
    SELECT ordinality AS step, split_part(line, '|', 1) AS result,
           split_part(line, '|', 2) AS check_name, split_part(line, '|', 3) AS detail
    FROM unnest(results) WITH ORDINALITY AS r(line, ordinality);
END
$verify$;
SELECT step, result, check_name, detail FROM pg_temp.bb_lifecycle_verify ORDER BY step;
