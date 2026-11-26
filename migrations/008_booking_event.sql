-- P5 of ARCH-20261114-booking-domain r02 (staging delegation, decisions of 2026-11-23).
-- Additive: booking -> event link (events.booking_id, one event per booking), event start
-- time and fee snapshot, events status CHECK, UNIQUE (workspace_id, id) on events, and an
-- optional promoter link on bookings, plus a trigger that lets an event be linked only to a
-- confirmed or completed booking, for every writer including raw REST, and triggers that
-- cancel the event of a cancelled booking and keep it cancelled, and a booking that has an
-- event cannot be deleted (cancel it instead).
-- No row is rewritten, nothing is backfilled.
-- Idempotent: safe to re-run. Requires 005. Prefix with an explicit target:
--   SET backbeat.booking_event_target = 'development';                 -- synthetic local
--   SET backbeat.booking_event_target = 'hosted:hupkygptbvnzrihrlcxv'; -- staging
-- Each target must match its own synthetic marker row in public.runtime_environment;
-- production has no marker table. Production is not an allowed target of this file.
-- Refuses to run while an event row has a status outside in_progress/confirmed/cancelled
-- (ops/supabase/booking-event/preflight.sql lists those rows).
-- Rollback: ops/supabase/booking-event/rollback.sql (see docs/booking-event.md).
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '15s';
DO $guard$
DECLARE
  target text := pg_catalog.current_setting('backbeat.booking_event_target', true);
  expected_id text;
  expected_environment text;
  relation text;
BEGIN
  -- Each explicit target must match the synthetic marker of the database it names:
  --   development                  -> backbeat-dev / development (local, migration 001)
  --   hosted:hupkygptbvnzrihrlcxv  -> backbeat-staging / staging (Backbeat staging)
  -- A missing marker table (production shape), zero or several rows, other values, or a
  -- marker that belongs to the other target are all refused.
  IF target = 'development' THEN
    expected_id := 'backbeat-dev'; expected_environment := 'development';
  ELSIF target = 'hosted:hupkygptbvnzrihrlcxv' THEN
    expected_id := 'backbeat-staging'; expected_environment := 'staging';
  ELSE
    RAISE EXCEPTION 'BOOKING_EVENT_TARGET_NOT_EXPLICIT';
  END IF;
  IF pg_catalog.to_regclass('public.runtime_environment') IS NULL THEN
    RAISE EXCEPTION 'BOOKING_EVENT_SYNTHETIC_MARKER_MISSING';
  END IF;
  IF (SELECT pg_catalog.count(*) FROM public.runtime_environment) <> 1 OR NOT EXISTS (
    SELECT 1 FROM public.runtime_environment
    WHERE id = expected_id AND environment = expected_environment AND synthetic_only IS TRUE
  ) THEN
    RAISE EXCEPTION 'BOOKING_EVENT_MARKER_DOES_NOT_MATCH_TARGET';
  END IF;
  IF pg_catalog.to_regprocedure('public.backbeat_is_active_member(uuid)') IS NULL THEN
    RAISE EXCEPTION 'BOOKING_EVENT_SHAPE_MISMATCH';
  END IF;
  FOREACH relation IN ARRAY ARRAY['public.events', 'public.bookings', 'public.promoters'] LOOP
    IF pg_catalog.to_regclass(relation) IS NULL OR NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_class
      WHERE oid = pg_catalog.to_regclass(relation) AND relrowsecurity
    ) THEN
      RAISE EXCEPTION 'BOOKING_EVENT_RLS_REQUIRED';
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
      WHERE conrelid = 'public.bookings'::pg_catalog.regclass
        AND conname = 'bookings_workspace_id_id_key' AND contype = 'u') THEN
    RAISE EXCEPTION 'BOOKING_EVENT_REQUIRES_005';
  END IF;
  -- The promoter link needs the same-workspace key that migration 001 gives promoters.
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint AS con
    WHERE con.conrelid = 'public.promoters'::pg_catalog.regclass AND con.contype IN ('u', 'p')
      AND (SELECT pg_catalog.array_agg(att.attname::text ORDER BY att.attname::text)
           FROM pg_catalog.unnest(con.conkey) AS key(attnum)
           JOIN pg_catalog.pg_attribute AS att
             ON att.attrelid = con.conrelid AND att.attnum = key.attnum)
          = ARRAY['id', 'workspace_id']
  ) THEN
    RAISE EXCEPTION 'BOOKING_EVENT_PROMOTERS_KEY_REQUIRED';
  END IF;
END
$guard$;
DO $requires$
BEGIN
  LOCK TABLE public.events IN SHARE ROW EXCLUSIVE MODE;
  IF EXISTS (SELECT 1 FROM public.events
      WHERE status IS NULL OR status NOT IN ('in_progress', 'confirmed', 'cancelled')) THEN
    RAISE EXCEPTION 'BOOKING_EVENT_UNEXPECTED_EVENT_STATUS_ROWS';
  END IF;
END
$requires$;

-- Decision 5: events status CHECK. Replace every single-column CHECK on events.status.
DO $status_check$
DECLARE existing record;
BEGIN
  FOR existing IN
    SELECT con.conname FROM pg_catalog.pg_constraint AS con
    WHERE con.conrelid = 'public.events'::pg_catalog.regclass AND con.contype = 'c'
      AND con.conkey = ARRAY[(SELECT att.attnum FROM pg_catalog.pg_attribute AS att
        WHERE att.attrelid = con.conrelid AND att.attname = 'status')]
  LOOP
    EXECUTE pg_catalog.format('ALTER TABLE public.events DROP CONSTRAINT %I', existing.conname);
  END LOOP;
END
$status_check$;
ALTER TABLE public.events
  ADD CONSTRAINT events_status_check CHECK (status IN ('in_progress', 'confirmed', 'cancelled'));

-- Decision 3: start time and fee snapshot on events, same rules as the booking fee (004).
-- Decision 1: the booking an event was created from.
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS booking_id uuid,
  ADD COLUMN IF NOT EXISTS start_time time,
  ADD COLUMN IF NOT EXISTS fee_amount_minor bigint,
  ADD COLUMN IF NOT EXISTS fee_currency text;
ALTER TABLE public.events
  DROP CONSTRAINT IF EXISTS events_fee_amount_minor_check,
  DROP CONSTRAINT IF EXISTS events_fee_currency_check,
  DROP CONSTRAINT IF EXISTS events_fee_pair_check;
ALTER TABLE public.events
  ADD CONSTRAINT events_fee_amount_minor_check
    CHECK (fee_amount_minor BETWEEN 0 AND 999999999999),
  ADD CONSTRAINT events_fee_currency_check
    CHECK (fee_currency IN ('EUR', 'USD', 'GBP', 'JPY')),
  ADD CONSTRAINT events_fee_pair_check
    CHECK ((fee_amount_minor IS NULL) = (fee_currency IS NULL));

-- Decision 2: optional promoter on bookings.
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS promoter_id uuid;

DO $keys$
BEGIN
  -- UNIQUE (workspace_id, id) on events, as artists, promoters and bookings already have.
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint AS con
    WHERE con.conrelid = 'public.events'::pg_catalog.regclass AND con.contype IN ('u', 'p')
      AND (SELECT pg_catalog.array_agg(att.attname::text ORDER BY att.attname::text)
           FROM pg_catalog.unnest(con.conkey) AS key(attnum)
           JOIN pg_catalog.pg_attribute AS att
             ON att.attrelid = con.conrelid AND att.attnum = key.attnum)
          = ARRAY['id', 'workspace_id']
  ) THEN
    ALTER TABLE public.events
      ADD CONSTRAINT events_workspace_id_id_key UNIQUE (workspace_id, id);
  END IF;
  -- One event per booking. NULLs stay distinct, so events without a booking are unlimited.
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
      WHERE conrelid = 'public.events'::pg_catalog.regclass AND conname = 'events_booking_id_key') THEN
    ALTER TABLE public.events ADD CONSTRAINT events_booking_id_key UNIQUE (booking_id);
  END IF;
  -- Same-workspace link. A booking that has an event cannot be deleted (Simone, 2026-11-26):
  -- NO ACTION, checked at the end of the statement, so deleting a whole workspace still
  -- cascades through its events and bookings. An earlier draft of this constraint with
  -- another delete rule is replaced.
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
      WHERE conrelid = 'public.events'::pg_catalog.regclass AND conname = 'events_booking_id_fkey'
        AND confdeltype <> 'a') THEN
    ALTER TABLE public.events DROP CONSTRAINT events_booking_id_fkey;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
      WHERE conrelid = 'public.events'::pg_catalog.regclass AND conname = 'events_booking_id_fkey') THEN
    ALTER TABLE public.events
      ADD CONSTRAINT events_booking_id_fkey FOREIGN KEY (workspace_id, booking_id)
        REFERENCES public.bookings (workspace_id, id) ON DELETE NO ACTION;
  END IF;
  -- Same-workspace link. Deleting the promoter keeps the booking: only promoter_id is nulled.
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
      WHERE conrelid = 'public.bookings'::pg_catalog.regclass AND conname = 'bookings_promoter_id_fkey') THEN
    ALTER TABLE public.bookings
      ADD CONSTRAINT bookings_promoter_id_fkey FOREIGN KEY (workspace_id, promoter_id)
        REFERENCES public.promoters (workspace_id, id) ON DELETE SET NULL (promoter_id);
  END IF;
END
$keys$;
CREATE INDEX IF NOT EXISTS bookings_workspace_promoter_idx
  ON public.bookings (workspace_id, promoter_id);

-- Decision 4 in the database: an event can be linked only to a booking that is confirmed or
-- completed at that moment. SECURITY INVOKER: runs as the writer, under the writer's RLS.
-- Evaluated only when the link is set or changed, so a later status change of the booking
-- neither unlinks nor blocks its event.
-- The booking row is locked FOR SHARE, so its status cannot change before this write commits.
-- A booking the writer cannot see or that does not exist is left to RLS and to
-- events_booking_id_fkey (42501 / 23503). SQLSTATE BB008 (006 uses BB001-BB003, 007 BB004-BB005, 010 of #33 BB006-BB007;
-- 008 uses BB008-BB011).
CREATE OR REPLACE FUNCTION public.backbeat_enforce_event_booking()
RETURNS trigger LANGUAGE plpgsql SET search_path = ''
AS $function$
DECLARE linked_status text;
BEGIN
  IF NEW.booking_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.booking_id IS NOT DISTINCT FROM OLD.booking_id
     AND NEW.workspace_id IS NOT DISTINCT FROM OLD.workspace_id THEN
    RETURN NEW;
  END IF;
  SELECT b.status INTO linked_status FROM public.bookings AS b
    WHERE b.id = NEW.booking_id AND b.workspace_id = NEW.workspace_id
    FOR SHARE;
  IF FOUND AND linked_status NOT IN ('confirmed', 'completed') THEN
    RAISE EXCEPTION 'EVENT_BOOKING_MUST_BE_CONFIRMED_OR_COMPLETED' USING ERRCODE = 'BB008';
  END IF;
  RETURN NEW;
END
$function$;
REVOKE ALL ON FUNCTION public.backbeat_enforce_event_booking() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS events_enforce_booking ON public.events;
CREATE TRIGGER events_enforce_booking BEFORE INSERT OR UPDATE OF booking_id, workspace_id ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.backbeat_enforce_event_booking();

-- Cancellation (Simone, 2026-11-25). A booking cancelled before conversion never gets an
-- event: the gate above refuses the link. A booking cancelled after conversion cancels its
-- event in the same transaction; the event keeps its booking link and every other column,
-- and is never deleted. A converted booking cannot leave `cancelled` (a rebooking is a new
-- booking with a new event), and the event of a cancelled booking cannot leave `cancelled`
-- or drop its link. SECURITY INVOKER: the writer's RLS applies; the existing FOR ALL
-- active-member policies on bookings and events give the same writers both tables.
-- SQLSTATE BB009 (converted booking leaves cancelled), BB010 (event of a cancelled booking
-- reactivated or unlinked).
CREATE OR REPLACE FUNCTION public.backbeat_cancel_booking_event()
RETURNS trigger LANGUAGE plpgsql SET search_path = ''
AS $function$
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NULL;
  END IF;
  IF OLD.status = 'cancelled' THEN
    IF EXISTS (SELECT 1 FROM public.events AS e
        WHERE e.booking_id = NEW.id AND e.workspace_id = NEW.workspace_id) THEN
      RAISE EXCEPTION 'CONVERTED_BOOKING_STAYS_CANCELLED' USING ERRCODE = 'BB009';
    END IF;
  ELSIF NEW.status = 'cancelled' THEN
    UPDATE public.events AS e SET status = 'cancelled'
      WHERE e.booking_id = NEW.id AND e.workspace_id = NEW.workspace_id
        AND e.status IS DISTINCT FROM 'cancelled';
  END IF;
  RETURN NULL;
END
$function$;
REVOKE ALL ON FUNCTION public.backbeat_cancel_booking_event() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS bookings_cancel_event ON public.bookings;
CREATE TRIGGER bookings_cancel_event AFTER UPDATE OF status ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.backbeat_cancel_booking_event();

-- The booking link is read from OLD.
CREATE OR REPLACE FUNCTION public.backbeat_keep_cancelled_event()
RETURNS trigger LANGUAGE plpgsql SET search_path = ''
AS $function$
BEGIN
  IF OLD.booking_id IS NULL OR OLD.status IS DISTINCT FROM 'cancelled' THEN
    RETURN NEW;
  END IF;
  IF NEW.status IS NOT DISTINCT FROM 'cancelled'
     AND NEW.booking_id IS NOT DISTINCT FROM OLD.booking_id THEN
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM public.bookings AS b
      WHERE b.id = OLD.booking_id AND b.workspace_id = OLD.workspace_id AND b.status = 'cancelled') THEN
    RAISE EXCEPTION 'EVENT_OF_CANCELLED_BOOKING_STAYS_CANCELLED' USING ERRCODE = 'BB010';
  END IF;
  RETURN NEW;
END
$function$;
REVOKE ALL ON FUNCTION public.backbeat_keep_cancelled_event() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS events_keep_cancelled ON public.events;
CREATE TRIGGER events_keep_cancelled BEFORE UPDATE OF status, booking_id ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.backbeat_keep_cancelled_event();

-- Deletion (Simone, 2026-11-26): a booking that has an event cannot be deleted; cancel it
-- instead. A booking without an event stays deletable. BB011 names the refusal of a direct
-- delete. A delete cascaded from another row (pg_trigger_depth() > 1: an artist or a
-- workspace) is left to events_booking_id_fkey (NO ACTION), which refuses an artist delete
-- with 23503 and lets a workspace delete pass, because that removes the events too.
-- SECURITY INVOKER: the writer's RLS applies; the FK check does not depend on it.
CREATE OR REPLACE FUNCTION public.backbeat_keep_booking_with_event()
RETURNS trigger LANGUAGE plpgsql SET search_path = ''
AS $function$
BEGIN
  IF pg_catalog.pg_trigger_depth() = 1 AND EXISTS (SELECT 1 FROM public.events AS e
      WHERE e.booking_id = OLD.id AND e.workspace_id = OLD.workspace_id) THEN
    RAISE EXCEPTION 'BOOKING_WITH_EVENT_CANNOT_BE_DELETED' USING ERRCODE = 'BB011';
  END IF;
  RETURN OLD;
END
$function$;
REVOKE ALL ON FUNCTION public.backbeat_keep_booking_with_event() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS bookings_keep_event ON public.bookings;
CREATE TRIGGER bookings_keep_event BEFORE DELETE ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.backbeat_keep_booking_with_event();

-- Decision 6: RLS, grants and policies on events, bookings and promoters are unchanged
-- (one FOR ALL active-member policy each). The new columns inherit them.
NOTIFY pgrst, 'reload schema';
COMMIT;
