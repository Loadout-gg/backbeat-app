-- A1 additive, once-only migration for the existing synthetic Development database.
-- No historical bootstrap replay; no business CRUD/artist-role policy changes.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $guard$
BEGIN
  IF pg_catalog.to_regclass('public.runtime_environment') IS NULL THEN
    RAISE EXCEPTION 'A1 requires the synthetic Development marker';
  END IF;
  LOCK TABLE public.runtime_environment IN SHARE MODE;
  IF (SELECT count(*) FROM public.runtime_environment) <> 1
     OR NOT EXISTS (SELECT 1 FROM public.runtime_environment
       WHERE id = 'backbeat-dev' AND environment = 'development' AND synthetic_only IS TRUE) THEN
    RAISE EXCEPTION 'A1 requires the exact singleton synthetic Development marker';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.unnest(ARRAY['runtime_environment', 'profiles', 'onboarding_status',
      'workspaces', 'workspace_members', 'artists', 'promoters', 'events', 'bookings']) AS required(name)
    WHERE NOT coalesce((SELECT c.relrowsecurity FROM pg_catalog.pg_class AS c
      WHERE c.oid = pg_catalog.to_regclass('public.' || required.name)), false)
  ) THEN
    RAISE EXCEPTION 'A1 requires all existing application tables with RLS enabled';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name IN ('first_name', 'last_name'))
     OR pg_catalog.to_regprocedure('public.backbeat_bootstrap_workspace(text)') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
       WHERE conrelid = 'public.workspace_members'::pg_catalog.regclass
         AND conname = 'workspace_members_role_check'
         AND pg_catalog.pg_get_constraintdef(oid) LIKE '%master%') THEN
    RAISE EXCEPTION 'A1 refusing repeat or partial application';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
      WHERE conrelid = 'public.workspace_members'::pg_catalog.regclass
        AND conname = 'workspace_members_role_check' AND contype = 'c')
     OR (SELECT count(*) FROM pg_catalog.pg_policies WHERE schemaname = 'public'
       AND (tablename, policyname) IN (('workspaces', 'workspace_insert'),
         ('workspace_members', 'membership_bootstrap'), ('onboarding_status', 'onboarding_update'))) <> 3
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger
       WHERE tgrelid = 'auth.users'::pg_catalog.regclass AND tgname = 'backbeat_auth_user_created'
         AND tgfoid = pg_catalog.to_regprocedure('public.backbeat_handle_new_user()') AND NOT tgisinternal)
     OR (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public'
       AND table_name = 'bookings' AND column_name IN ('venue_name', 'venue_address',
         'contact_name_main', 'contact_phone_main', 'contact_email_main')) <> 5 THEN
    RAISE EXCEPTION 'A1 requires the current 001/002 schema and legacy policies';
  END IF;
END
$guard$;

ALTER TABLE public.profiles
  ADD COLUMN first_name text,
  ADD COLUMN last_name text,
  ADD CONSTRAINT profiles_first_name_sane CHECK (first_name IS NULL OR
    (pg_catalog.char_length(first_name) BETWEEN 1 AND 100 AND first_name = pg_catalog.btrim(first_name) AND first_name !~ '[[:cntrl:]]')),
  ADD CONSTRAINT profiles_last_name_sane CHECK (last_name IS NULL OR
    (pg_catalog.char_length(last_name) BETWEEN 1 AND 100 AND last_name = pg_catalog.btrim(last_name) AND last_name !~ '[[:cntrl:]]'));

-- Only the app-owned INSERT hook changes. Existing identity/avatar values remain intact.
CREATE OR REPLACE FUNCTION public.backbeat_handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $identity$
DECLARE
  given_name text;
  family_name text;
  display_name text;
BEGIN
  IF pg_catalog.jsonb_typeof(NEW.raw_user_meta_data -> 'first_name') = 'string' THEN
    given_name := pg_catalog.btrim(NEW.raw_user_meta_data ->> 'first_name');
    IF pg_catalog.char_length(given_name) NOT BETWEEN 1 AND 100 OR given_name ~ '[[:cntrl:]]' THEN
      given_name := NULL;
    END IF;
  END IF;
  IF pg_catalog.jsonb_typeof(NEW.raw_user_meta_data -> 'last_name') = 'string' THEN
    family_name := pg_catalog.btrim(NEW.raw_user_meta_data ->> 'last_name');
    IF pg_catalog.char_length(family_name) NOT BETWEEN 1 AND 100 OR family_name ~ '[[:cntrl:]]' THEN
      family_name := NULL;
    END IF;
  END IF;
  IF given_name IS NOT NULL AND family_name IS NOT NULL THEN
    display_name := given_name || ' ' || family_name;
  ELSIF pg_catalog.jsonb_typeof(NEW.raw_user_meta_data -> 'full_name') = 'string' THEN
    display_name := pg_catalog.btrim(NEW.raw_user_meta_data ->> 'full_name');
    IF pg_catalog.char_length(display_name) NOT BETWEEN 1 AND 201 OR display_name ~ '[[:cntrl:]]' THEN
      display_name := NULL;
    END IF;
  END IF;
  INSERT INTO public.profiles (id, first_name, last_name, full_name)
    VALUES (NEW.id, given_name, family_name, display_name);
  INSERT INTO public.onboarding_status (user_id, completed, workspace_id)
    VALUES (NEW.id, false, NULL);
  RETURN NEW;
END
$identity$;
REVOKE ALL ON FUNCTION public.backbeat_handle_new_user() FROM PUBLIC, anon, authenticated;

ALTER TABLE public.workspace_members DROP CONSTRAINT workspace_members_role_check;
ALTER TABLE public.workspace_members ADD CONSTRAINT workspace_members_role_check
  CHECK (role IN ('master', 'admin', 'member'));
-- Synthetic-only historical ownership alignment; no inactive/reactivated or unrelated rows.
UPDATE public.workspace_members AS m SET role = 'master'
FROM public.workspaces AS w
WHERE w.id = m.workspace_id
  AND m.role = 'admin' AND m.status = 'active' AND w.created_by = m.user_id;

CREATE FUNCTION public.backbeat_bootstrap_workspace(workspace_name text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $bootstrap$
DECLARE
  actor uuid := auth.uid();
  normalized_name text := pg_catalog.btrim(workspace_name);
  selected_workspace uuid;
  active_count bigint;
BEGIN
  IF actor IS NULL OR auth.role() IS DISTINCT FROM 'authenticated' THEN
    RAISE EXCEPTION 'Authenticated user required' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users AS u WHERE u.id = actor AND u.email_confirmed_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Confirm your email before creating a workspace' USING ERRCODE = '42501';
  END IF;
  IF normalized_name IS NULL OR pg_catalog.char_length(normalized_name) NOT BETWEEN 1 AND 200
     OR workspace_name ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'Workspace name must be 1-200 characters without control characters' USING ERRCODE = '22023';
  END IF;
  -- Collision only serializes unrelated actors; never grants access. All reads follow the lock.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text, 314159));
  SELECT o.workspace_id INTO selected_workspace FROM public.onboarding_status AS o WHERE o.user_id = actor;
  IF selected_workspace IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.workspace_members AS m
      JOIN public.workspaces AS w ON w.id = m.workspace_id
      WHERE m.user_id = actor AND m.workspace_id = selected_workspace AND m.status = 'active') THEN
      RAISE EXCEPTION 'Selected workspace has no active membership' USING ERRCODE = '42501';
    END IF;
  ELSE
    SELECT pg_catalog.count(*) INTO active_count FROM public.workspace_members AS m
      WHERE m.user_id = actor AND m.status = 'active';
    IF active_count > 1 THEN
      RAISE EXCEPTION 'Ambiguous active memberships; contact your workspace administrator' USING ERRCODE = '42501';
    ELSIF active_count = 1 THEN
      SELECT m.workspace_id INTO selected_workspace FROM public.workspace_members AS m
        WHERE m.user_id = actor AND m.status = 'active';
    ELSE
      IF EXISTS (SELECT 1 FROM public.workspace_members AS m WHERE m.user_id = actor) THEN
        RAISE EXCEPTION 'Inactive or pending membership; contact your workspace administrator' USING ERRCODE = '42501';
      END IF;
      IF EXISTS (SELECT 1 FROM public.workspaces AS w WHERE w.created_by = actor) THEN
        RAISE EXCEPTION 'Orphan owned workspace; contact your workspace administrator' USING ERRCODE = '42501';
      END IF;
      INSERT INTO public.workspaces (name, created_by) VALUES (normalized_name, actor)
        RETURNING id INTO selected_workspace;
      INSERT INTO public.workspace_members (workspace_id, user_id, role, status)
        VALUES (selected_workspace, actor, 'master', 'active');
    END IF;
  END IF;
  INSERT INTO public.onboarding_status (user_id, completed, workspace_id)
    VALUES (actor, true, selected_workspace)
    ON CONFLICT (user_id) DO UPDATE SET completed = true, workspace_id = EXCLUDED.workspace_id;
  RETURN selected_workspace;
END
$bootstrap$;
REVOKE ALL ON FUNCTION public.backbeat_bootstrap_workspace(text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.backbeat_bootstrap_workspace(text) TO authenticated;

-- Remove both table and column-level write paths; RLS policy removal is defense in depth.
REVOKE INSERT ON public.workspaces, public.workspace_members FROM PUBLIC, anon, authenticated;
REVOKE INSERT (id, name, created_by, created_at) ON public.workspaces FROM PUBLIC, anon, authenticated;
REVOKE INSERT (workspace_id, user_id, role, status) ON public.workspace_members FROM PUBLIC, anon, authenticated;
REVOKE UPDATE ON public.onboarding_status FROM PUBLIC, anon, authenticated;
REVOKE UPDATE (user_id, completed, workspace_id) ON public.onboarding_status FROM PUBLIC, anon, authenticated;
REVOKE UPDATE (completed, workspace_id) ON public.onboarding_status FROM PUBLIC, anon, authenticated;
DROP POLICY workspace_insert ON public.workspaces;
DROP POLICY membership_bootstrap ON public.workspace_members;
DROP POLICY onboarding_update ON public.onboarding_status;
-- Creator name UPDATE/DELETE, profile legacy UPDATE and scoped business CRUD remain unchanged.

NOTIFY pgrst, 'reload schema';
COMMIT;
