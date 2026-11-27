-- Post-apply verification for migration 007 plus the forward guard. Synthetic development fixtures only.
-- Acts through the authenticated role as two fixture users: an active member of one booking's
-- workspace and a user who is not a member of it, plus the anon role.
-- Needs one booking without payments in a workspace with an active member, and one account
-- outside that workspace; otherwise the affected checks report SKIP.
-- Every write happens inside a block that is always rolled back: no row is changed and
-- nothing is left behind. The report is the result of the final SELECT:
--   first row "SUMMARY | ALL PASS | pass=22 fail=0 skip=0", then one row per check.
-- "FAILED" or "INCOMPLETE" in the summary means do not merge.
DO $verify$
DECLARE
  target record;
  member uuid;
  outsider uuid;
  payment uuid;
  results text[] := ARRAY[]::text[];
  outcome text;
  affected bigint;
BEGIN
  IF current_setting('backbeat.booking_finance_target', true) IS DISTINCT FROM 'development' THEN
    RAISE EXCEPTION 'BOOKING_FINANCE_VERIFY_FIXTURES_ONLY';
  END IF;
  IF (SELECT count(*) FROM public.runtime_environment) <> 1 OR NOT EXISTS (
    SELECT 1 FROM public.runtime_environment WHERE id = 'backbeat-dev' AND environment = 'development' AND synthetic_only IS TRUE
  ) THEN
    RAISE EXCEPTION 'BOOKING_FINANCE_VERIFY_FIXTURES_ONLY';
  END IF;
  PERFORM set_config('backbeat.finance_verify_report', '', false);
  SELECT b.id, b.workspace_id, b.artist_id, b.fee_currency INTO target
    FROM public.bookings AS b
    WHERE EXISTS (SELECT 1 FROM public.workspace_members AS m
        WHERE m.workspace_id = b.workspace_id AND m.status = 'active')
      AND NOT EXISTS (SELECT 1 FROM public.booking_payments AS p WHERE p.booking_id = b.id)
    ORDER BY b.created_at DESC, b.id LIMIT 1;
  IF target.id IS NOT NULL THEN
    SELECT m.user_id INTO member FROM public.workspace_members AS m
      WHERE m.workspace_id = target.workspace_id AND m.status = 'active'
      ORDER BY m.user_id LIMIT 1;
    SELECT u.id INTO outsider FROM auth.users AS u
      WHERE NOT EXISTS (SELECT 1 FROM public.workspace_members AS m
        WHERE m.workspace_id = target.workspace_id AND m.user_id = u.id)
      ORDER BY u.id LIMIT 1;
  END IF;

  BEGIN
    IF target.id IS NULL OR member IS NULL THEN
      results := results || 'SKIP|all|no booking without payments in a workspace with an active member; create one in the app'::text;
      RAISE EXCEPTION 'BB_VERIFY_ROLLBACK';
    END IF;

    -- Member: same role and claims the API uses.
    PERFORM set_config('request.jwt.claim.sub', member::text, true);
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', member, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;

    UPDATE public.bookings SET fee_amount_minor = NULL, fee_currency = NULL,
      commission_type = NULL, commission_value = NULL, commission_mode = NULL WHERE id = target.id;
    BEGIN
      INSERT INTO public.booking_payments (workspace_id, booking_id, kind, amount_minor, currency)
        VALUES (target.workspace_id, target.id, 'deposit', 1000, 'EUR');
      outcome := 'inserted';
    EXCEPTION WHEN OTHERS THEN outcome := SQLSTATE;
    END;
    results := results || (CASE WHEN outcome = 'BB004' THEN 'PASS' ELSE 'FAIL' END
      || '|currency: payment on a booking without fee rejected|' || outcome || ' (expected BB004)');

    UPDATE public.bookings SET fee_amount_minor = 100000, fee_currency = 'EUR' WHERE id = target.id;
    BEGIN
      INSERT INTO public.booking_payments (workspace_id, booking_id, kind, amount_minor, currency)
        VALUES (target.workspace_id, target.id, 'deposit', 1000, 'USD');
      outcome := 'inserted';
    EXCEPTION WHEN OTHERS THEN outcome := SQLSTATE;
    END;
    results := results || (CASE WHEN outcome = 'BB004' THEN 'PASS' ELSE 'FAIL' END
      || '|currency: payment in another currency rejected|' || outcome || ' (expected BB004)');
    BEGIN
      INSERT INTO public.booking_payments (workspace_id, booking_id, kind, amount_minor, currency)
        VALUES (target.workspace_id, target.id, 'deposit', 0, 'EUR');
      outcome := 'inserted';
    EXCEPTION WHEN OTHERS THEN outcome := SQLSTATE;
    END;
    results := results || (CASE WHEN outcome = '23514' THEN 'PASS' ELSE 'FAIL' END
      || '|amount: zero rejected|' || outcome || ' (expected 23514)');
    BEGIN
      INSERT INTO public.booking_payments (workspace_id, booking_id, kind, amount_minor, currency, due_on)
        VALUES (target.workspace_id, target.id, 'deposit', 30000, 'EUR', CURRENT_DATE)
        RETURNING id INTO payment;
      outcome := 'inserted';
    EXCEPTION WHEN OTHERS THEN outcome := SQLSTATE;
    END;
    results := results || (CASE WHEN outcome = 'inserted' THEN 'PASS' ELSE 'FAIL' END
      || '|member: records a payment in the fee currency|' || outcome);
    BEGIN
      UPDATE public.booking_payments SET paid_on = CURRENT_DATE WHERE id = payment;
      GET DIAGNOSTICS affected = ROW_COUNT;
      outcome := 'rows=' || affected;
    EXCEPTION WHEN OTHERS THEN outcome := SQLSTATE;
    END;
    results := results || (CASE WHEN outcome = 'rows=1' THEN 'PASS' ELSE 'FAIL' END
      || '|member: marks the payment as paid|' || outcome);
    BEGIN
      UPDATE public.bookings SET fee_currency = 'USD' WHERE id = target.id;
      outcome := 'updated';
    EXCEPTION WHEN OTHERS THEN outcome := SQLSTATE;
    END;
    results := results || (CASE WHEN outcome = 'BB005' THEN 'PASS' ELSE 'FAIL' END
      || '|fee: currency change with payments rejected|' || outcome || ' (expected BB005)');
    BEGIN
      UPDATE public.bookings SET fee_amount_minor = NULL, fee_currency = NULL WHERE id = target.id;
      outcome := 'updated';
    EXCEPTION WHEN OTHERS THEN outcome := SQLSTATE;
    END;
    results := results || (CASE WHEN outcome = 'BB005' THEN 'PASS' ELSE 'FAIL' END
      || '|fee: clearing the fee with payments rejected|' || outcome || ' (expected BB005)');
    BEGIN
      UPDATE public.bookings SET fee_amount_minor = 120000 WHERE id = target.id;
      outcome := 'updated';
    EXCEPTION WHEN OTHERS THEN outcome := SQLSTATE;
    END;
    results := results || (CASE WHEN outcome = 'updated' THEN 'PASS' ELSE 'FAIL' END
      || '|fee: amount change with payments allowed|' || outcome);
    BEGIN
      UPDATE public.bookings SET commission_type = 'percent', commission_value = 1500,
        commission_mode = 'on_top', tax_note = 'verify' WHERE id = target.id;
      outcome := 'updated';
    EXCEPTION WHEN OTHERS THEN outcome := SQLSTATE;
    END;
    results := results || (CASE WHEN outcome = 'updated' THEN 'PASS' ELSE 'FAIL' END
      || '|commission: percent on top and tax note stored|' || outcome);
    BEGIN
      UPDATE public.bookings SET commission_type = 'percent', commission_value = 10001 WHERE id = target.id;
      outcome := 'updated';
    EXCEPTION WHEN OTHERS THEN outcome := SQLSTATE;
    END;
    results := results || (CASE WHEN outcome = '23514' THEN 'PASS' ELSE 'FAIL' END
      || '|commission: more than 100 percent rejected|' || outcome || ' (expected 23514)');
    BEGIN
      UPDATE public.bookings SET commission_type = 'fixed', commission_value = 120001,
        commission_mode = 'included' WHERE id = target.id;
      outcome := 'updated';
    EXCEPTION WHEN OTHERS THEN outcome := SQLSTATE;
    END;
    results := results || (CASE WHEN outcome = '23514' THEN 'PASS' ELSE 'FAIL' END
      || '|commission: included fixed amount above the fee rejected|' || outcome || ' (expected 23514)');
    BEGIN
      DELETE FROM public.bookings WHERE id = target.id;
      outcome := 'deleted';
    EXCEPTION WHEN OTHERS THEN outcome := SQLSTATE;
    END;
    results := results || (CASE WHEN outcome IN ('23503', '23001') THEN 'PASS' ELSE 'FAIL' END
      || '|delete: booking with payments rejected|' || outcome || ' (expected 23503)');

    -- Artist default commission: type, value and mode together; a currency only for fixed.
    BEGIN
      UPDATE public.artists SET default_commission_type = 'percent', default_commission_value = 1250,
        default_commission_mode = 'included', default_commission_currency = NULL WHERE id = target.artist_id;
      GET DIAGNOSTICS affected = ROW_COUNT;
      outcome := 'rows=' || affected;
    EXCEPTION WHEN OTHERS THEN outcome := SQLSTATE;
    END;
    results := results || (CASE WHEN outcome = 'rows=1' THEN 'PASS' ELSE 'FAIL' END
      || '|artist default: percent with a mode and no currency stored|' || outcome);
    BEGIN
      UPDATE public.artists SET default_commission_currency = 'EUR' WHERE id = target.artist_id;
      outcome := 'updated';
    EXCEPTION WHEN OTHERS THEN outcome := SQLSTATE;
    END;
    results := results || (CASE WHEN outcome = '23514' THEN 'PASS' ELSE 'FAIL' END
      || '|artist default: currency on a percent default rejected|' || outcome || ' (expected 23514)');
    BEGIN
      UPDATE public.artists SET default_commission_type = 'fixed', default_commission_value = 25000 WHERE id = target.artist_id;
      outcome := 'updated';
    EXCEPTION WHEN OTHERS THEN outcome := SQLSTATE;
    END;
    results := results || (CASE WHEN outcome = '23514' THEN 'PASS' ELSE 'FAIL' END
      || '|artist default: fixed without a currency rejected|' || outcome || ' (expected 23514)');
    BEGIN
      UPDATE public.artists SET default_commission_type = 'fixed', default_commission_value = 25000,
        default_commission_mode = 'on_top', default_commission_currency = 'JPY' WHERE id = target.artist_id;
      GET DIAGNOSTICS affected = ROW_COUNT;
      outcome := 'rows=' || affected;
    EXCEPTION WHEN OTHERS THEN outcome := SQLSTATE;
    END;
    results := results || (CASE WHEN outcome = 'rows=1' THEN 'PASS' ELSE 'FAIL' END
      || '|artist default: fixed with its own currency stored|' || outcome);
    RESET ROLE;

    -- Outsider: must neither see nor write payments of the workspace.
    IF outsider IS NULL THEN
      results := results || 'SKIP|rls: outsider|no user outside the booking workspace; sign up a second account'::text;
    ELSE
      PERFORM set_config('request.jwt.claim.sub', outsider::text, true);
      PERFORM set_config('request.jwt.claims',
        json_build_object('sub', outsider, 'role', 'authenticated')::text, true);
      SET LOCAL ROLE authenticated;
      SELECT count(*) INTO affected FROM public.booking_payments WHERE workspace_id = target.workspace_id;
      results := results || (CASE WHEN affected = 0 THEN 'PASS' ELSE 'FAIL' END
        || '|rls: outsider sees no payment of the workspace|visible rows=' || affected);
      UPDATE public.booking_payments SET amount_minor = 1 WHERE id = payment;
      GET DIAGNOSTICS affected = ROW_COUNT;
      results := results || (CASE WHEN affected = 0 THEN 'PASS' ELSE 'FAIL' END
        || '|rls: outsider cannot change a payment|rows changed=' || affected);
      BEGIN
        DELETE FROM public.booking_payments WHERE id = payment;
        outcome := 'deleted';
      EXCEPTION WHEN OTHERS THEN outcome := SQLSTATE;
      END;
      results := results || (CASE WHEN outcome = '42501' THEN 'PASS' ELSE 'FAIL' END
        || '|grants: outsider cannot delete a payment|' || outcome || ' (expected 42501)');
      BEGIN
        INSERT INTO public.booking_payments (workspace_id, booking_id, kind, amount_minor, currency)
          VALUES (target.workspace_id, target.id, 'other', 100, 'EUR');
        outcome := 'inserted';
      EXCEPTION WHEN OTHERS THEN outcome := SQLSTATE;
      END;
      results := results || (CASE WHEN outcome = '42501' THEN 'PASS' ELSE 'FAIL' END
        || '|rls: outsider cannot insert into the workspace|' || outcome || ' (expected 42501)');
      RESET ROLE;
    END IF;

    -- anon: no table privilege at all.
    SET LOCAL ROLE anon;
    BEGIN
      SELECT count(*) INTO affected FROM public.booking_payments;
      outcome := 'visible rows=' || affected;
    EXCEPTION WHEN OTHERS THEN outcome := SQLSTATE;
    END;
    results := results || (CASE WHEN outcome = '42501' THEN 'PASS' ELSE 'FAIL' END
      || '|grants: anon cannot read payments|' || outcome || ' (expected 42501)');
    RESET ROLE;

    -- Member again: direct DELETE is denied even with a matching active membership.
    PERFORM set_config('request.jwt.claim.sub', member::text, true);
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', member, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    BEGIN
      DELETE FROM public.booking_payments WHERE id = payment;
      outcome := 'deleted';
    EXCEPTION WHEN OTHERS THEN outcome := SQLSTATE;
    END;
    results := results || (CASE WHEN outcome = '42501' THEN 'PASS' ELSE 'FAIL' END
      || '|grants: member cannot delete a payment|' || outcome || ' (expected 42501)');
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
  PERFORM set_config('backbeat.finance_verify_report', array_to_string(results, E'\n'), false);
END
$verify$;
WITH lines AS (
  SELECT ordinality AS ord, split_part(line, '|', 1) AS result,
         split_part(line, '|', 2) AS item, split_part(line, '|', 3) AS detail
  FROM unnest(string_to_array(nullif(current_setting('backbeat.finance_verify_report', true), ''), E'\n'))
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
