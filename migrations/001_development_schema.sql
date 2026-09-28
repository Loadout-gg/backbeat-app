-- Fresh LOCAL development bootstrap only: synthetic data, PostgreSQL 17/Supabase.
-- Apply once as the trusted database owner. Never apply historical scripts first.
-- Existing app relations (including an earlier marker) cause a full rollback.
BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_class AS c
    JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = ANY (ARRAY[
      'profiles', 'onboarding_status', 'workspaces', 'workspace_members',
      'artists', 'promoters', 'events', 'bookings', 'runtime_environment'
    ])
  ) THEN
    RAISE EXCEPTION 'Refusing bootstrap: an application relation already exists';
  END IF;
END;
$$;

CREATE TABLE public.runtime_environment (
  id text PRIMARY KEY CHECK (id = 'backbeat-dev'),
  environment text NOT NULL CHECK (environment = 'development'),
  synthetic_only boolean NOT NULL CHECK (synthetic_only = true)
);
INSERT INTO public.runtime_environment (id, environment, synthetic_only)
VALUES ('backbeat-dev', 'development', true);

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text,
  avatar_url text,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now()
);
CREATE TABLE public.workspaces (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  name text NOT NULL,
  created_by uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now()
);
CREATE TABLE public.workspace_members (
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('admin', 'member')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'pending')),
  PRIMARY KEY (workspace_id, user_id)
);
CREATE TABLE public.onboarding_status (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  completed boolean NOT NULL DEFAULT false,
  -- Completed may remain true after workspace removal; NULL is always permissible.
  workspace_id uuid REFERENCES public.workspaces(id) ON DELETE SET NULL
);
CREATE TABLE public.artists (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  email text,
  phone text,
  notes text,
  stage_name text,
  surname text,
  location text,
  travel_fee text,
  pricing_notes text,
  overview text,
  dj_equipment text,
  sound_system text,
  allergies text,
  special_diet text,
  special_needs text,
  genres text[] DEFAULT '{}'::text[],
  fee numeric,
  currency text DEFAULT 'USD',
  social_links jsonb DEFAULT '[]'::jsonb,
  documents jsonb DEFAULT '[]'::jsonb,
  profile_image_url text,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  UNIQUE (workspace_id, id)
);
CREATE TABLE public.promoters (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  company_name text,
  email text,
  phone text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  UNIQUE (workspace_id, id)
);
CREATE TABLE public.events (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  title text NOT NULL,
  date date NOT NULL,
  location text,
  status text NOT NULL DEFAULT 'in_progress',
  artist_id uuid,
  promoter_id uuid,
  public_token text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  -- Constraint names preserve artists:artist_id / promoters:promoter_id embeds.
  -- One FK per relationship avoids ambiguous direct + composite relationships.
  CONSTRAINT artist_id FOREIGN KEY (workspace_id, artist_id)
    REFERENCES public.artists(workspace_id, id) ON DELETE SET NULL (artist_id),
  CONSTRAINT promoter_id FOREIGN KEY (workspace_id, promoter_id)
    REFERENCES public.promoters(workspace_id, id) ON DELETE SET NULL (promoter_id)
);
CREATE TABLE public.bookings (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  artist_id uuid NOT NULL,
  date date NOT NULL,
  start_time time NOT NULL,
  duration_minutes integer,
  notes text,
  status text NOT NULL DEFAULT 'in_progress'
    CHECK (status IN ('in_progress', 'confirmed', 'cancelled', 'completed')),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT bookings_artist_id_fkey FOREIGN KEY (workspace_id, artist_id)
    REFERENCES public.artists(workspace_id, id) ON DELETE CASCADE
);

-- Non-recursive RLS helpers: trusted owner bypasses RLS, never caller-selected UID.
CREATE FUNCTION public.backbeat_is_active_member(target_workspace uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.workspace_members AS m
    WHERE m.workspace_id = target_workspace AND m.user_id = auth.uid()
      AND m.status = 'active'
  );
$$;
CREATE FUNCTION public.backbeat_is_workspace_creator(target_workspace uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.workspaces AS w
    WHERE w.id = target_workspace AND w.created_by = auth.uid()
  );
$$;
REVOKE ALL ON FUNCTION public.backbeat_is_active_member(uuid),
  public.backbeat_is_workspace_creator(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.backbeat_is_active_member(uuid),
  public.backbeat_is_workspace_creator(uuid) TO authenticated;

CREATE FUNCTION public.backbeat_handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.profiles (id) VALUES (NEW.id);
  INSERT INTO public.onboarding_status (user_id, completed, workspace_id)
    VALUES (NEW.id, false, NULL);
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.backbeat_handle_new_user() FROM PUBLIC, anon, authenticated;
-- Adds only the application signup hook; no stock auth object is replaced.
CREATE TRIGGER backbeat_auth_user_created AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.backbeat_handle_new_user();

CREATE FUNCTION public.backbeat_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = pg_catalog.now();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.backbeat_touch_updated_at() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER artists_updated_at BEFORE UPDATE ON public.artists
  FOR EACH ROW EXECUTE FUNCTION public.backbeat_touch_updated_at();
CREATE TRIGGER bookings_updated_at BEFORE UPDATE ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.backbeat_touch_updated_at();

ALTER TABLE public.runtime_environment ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.onboarding_status ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.artists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.promoters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;

-- Remove Supabase's possible default table grants before assigning minimum access.
REVOKE ALL ON TABLE public.runtime_environment, public.profiles,
  public.onboarding_status, public.workspaces, public.workspace_members,
  public.artists, public.promoters, public.events, public.bookings
  FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT SELECT ON public.runtime_environment TO anon, authenticated;
GRANT SELECT ON public.profiles, public.onboarding_status,
  public.workspaces, public.workspace_members TO authenticated;
GRANT UPDATE (full_name, avatar_url) ON public.profiles TO authenticated;
GRANT UPDATE (completed, workspace_id) ON public.onboarding_status TO authenticated;
GRANT INSERT, DELETE ON public.workspaces TO authenticated;
GRANT UPDATE (name) ON public.workspaces TO authenticated;
GRANT INSERT ON public.workspace_members TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.artists, public.promoters,
  public.events, public.bookings TO authenticated;

CREATE POLICY marker_read ON public.runtime_environment
  FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY profile_read ON public.profiles FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL AND id = auth.uid());
CREATE POLICY profile_update ON public.profiles FOR UPDATE TO authenticated
  USING (auth.uid() IS NOT NULL AND id = auth.uid())
  WITH CHECK (auth.uid() IS NOT NULL AND id = auth.uid());
CREATE POLICY onboarding_read ON public.onboarding_status FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL AND user_id = auth.uid());
CREATE POLICY onboarding_update ON public.onboarding_status FOR UPDATE TO authenticated
  USING (auth.uid() IS NOT NULL AND user_id = auth.uid())
  WITH CHECK (auth.uid() IS NOT NULL AND user_id = auth.uid()
    AND (workspace_id IS NULL OR public.backbeat_is_active_member(workspace_id)));

-- Creator visibility is essential for INSERT ... RETURNING before self-membership.
-- DEFAULT auth.uid() fills omission; explicit forged values fail WITH CHECK (42501).
CREATE POLICY workspace_read ON public.workspaces FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL AND
    (created_by = auth.uid() OR public.backbeat_is_active_member(id)));
CREATE POLICY workspace_insert ON public.workspaces FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL AND created_by = auth.uid());
CREATE POLICY workspace_update ON public.workspaces FOR UPDATE TO authenticated
  USING (auth.uid() IS NOT NULL AND created_by = auth.uid())
  WITH CHECK (auth.uid() IS NOT NULL AND created_by = auth.uid());
CREATE POLICY workspace_delete ON public.workspaces FOR DELETE TO authenticated
  USING (auth.uid() IS NOT NULL AND created_by = auth.uid());

CREATE POLICY membership_read ON public.workspace_members FOR SELECT TO authenticated
  -- Direct self visibility also supports INSERT RETURNING in the same statement,
  -- without depending on a STABLE helper seeing a newly inserted membership.
  USING (auth.uid() IS NOT NULL AND
    ((user_id = auth.uid() AND status = 'active')
      OR public.backbeat_is_active_member(workspace_id)));
CREATE POLICY membership_bootstrap ON public.workspace_members FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL AND user_id = auth.uid()
    AND role = 'admin' AND status = 'active'
    AND public.backbeat_is_workspace_creator(workspace_id));
-- No membership UPDATE/DELETE grants or policies. FK cascades still clean up.

CREATE POLICY artist_access ON public.artists FOR ALL TO authenticated
  USING (public.backbeat_is_active_member(workspace_id))
  WITH CHECK (public.backbeat_is_active_member(workspace_id));
CREATE POLICY promoter_access ON public.promoters FOR ALL TO authenticated
  USING (public.backbeat_is_active_member(workspace_id))
  WITH CHECK (public.backbeat_is_active_member(workspace_id));
CREATE POLICY event_access ON public.events FOR ALL TO authenticated
  USING (public.backbeat_is_active_member(workspace_id))
  WITH CHECK (public.backbeat_is_active_member(workspace_id));
CREATE POLICY booking_access ON public.bookings FOR ALL TO authenticated
  USING (public.backbeat_is_active_member(workspace_id))
  WITH CHECK (public.backbeat_is_active_member(workspace_id));

CREATE INDEX workspace_members_user_id_idx ON public.workspace_members(user_id);
CREATE INDEX events_workspace_id_idx ON public.events(workspace_id);
CREATE INDEX bookings_workspace_artist_idx ON public.bookings(workspace_id, artist_id);
CREATE INDEX onboarding_workspace_id_idx ON public.onboarding_status(workspace_id);

COMMIT;
NOTIFY pgrst, 'reload schema';
