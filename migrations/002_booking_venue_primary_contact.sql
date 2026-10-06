-- M2 additive migration for the EXISTING synthetic local Development database only.
-- Run once after 001; never rerun 001 or apply this file to production.
-- Old bookings retain every old value and get NULL for the five new columns.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $guard$
BEGIN
  IF pg_catalog.to_regclass('public.runtime_environment') IS NULL THEN
    RAISE EXCEPTION 'M2 requires the synthetic Development marker';
  END IF;
  IF (SELECT count(*) FROM public.runtime_environment) <> 1
     OR NOT EXISTS (SELECT 1 FROM public.runtime_environment
       WHERE id = 'backbeat-dev' AND environment = 'development' AND synthetic_only IS TRUE) THEN
    RAISE EXCEPTION 'M2 requires the exact singleton synthetic Development marker';
  END IF;
  IF NOT coalesce((SELECT relrowsecurity FROM pg_catalog.pg_class
                   WHERE oid = pg_catalog.to_regclass('public.bookings')), false) THEN
    RAISE EXCEPTION 'M2 requires existing bookings with RLS enabled';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'bookings'
               AND column_name IN ('venue_name', 'venue_address', 'contact_name_main',
                                   'contact_phone_main', 'contact_email_main')) THEN
    RAISE EXCEPTION 'M2 fields already exist; refusing repeat or partial bootstrap';
  END IF;
END
$guard$;

ALTER TABLE public.bookings
  ADD COLUMN venue_name text,
  ADD COLUMN venue_address text,
  ADD COLUMN contact_name_main text,
  ADD COLUMN contact_phone_main text,
  ADD COLUMN contact_email_main text,
  ADD CONSTRAINT bookings_venue_name_length CHECK (char_length(venue_name) <= 200),
  ADD CONSTRAINT bookings_venue_address_length CHECK (char_length(venue_address) <= 1000),
  ADD CONSTRAINT bookings_contact_name_main_length CHECK (char_length(contact_name_main) <= 200),
  ADD CONSTRAINT bookings_contact_phone_main_length CHECK (char_length(contact_phone_main) <= 100),
  ADD CONSTRAINT bookings_contact_email_main_length CHECK (char_length(contact_email_main) <= 254);

-- RLS, grants, ownership, old constraints and rows are deliberately unchanged.
-- App validation owns trim/blank-to-NULL and nonblank email format validation.
NOTIFY pgrst, 'reload schema';
COMMIT;
