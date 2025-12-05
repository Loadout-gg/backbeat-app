-- Backbeat MVP Database Schema
-- Run this script to create all necessary tables with RLS policies

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =============================================================================
-- CREATE ALL TABLES FIRST (before RLS policies that reference other tables)
-- =============================================================================

-- WORKSPACES TABLE
CREATE TABLE IF NOT EXISTS workspaces (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- WORKSPACE MEMBERS TABLE
CREATE TABLE IF NOT EXISTS workspace_members (
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('admin', 'member')),
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'pending')),
  PRIMARY KEY (workspace_id, user_id)
);

-- PROFILES TABLE
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ONBOARDING STATUS TABLE
CREATE TABLE IF NOT EXISTS onboarding_status (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  completed BOOLEAN DEFAULT FALSE,
  workspace_id UUID REFERENCES workspaces(id) ON DELETE SET NULL
);

-- =============================================================================
-- ENABLE RLS ON ALL TABLES
-- =============================================================================

ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_status ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- RLS POLICIES FOR WORKSPACES
-- =============================================================================

-- Users can read workspaces they are members of
CREATE POLICY "Users can read their workspaces" ON workspaces
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM workspace_members
      WHERE workspace_members.workspace_id = workspaces.id
      AND workspace_members.user_id = auth.uid()
    )
  );

-- Users can create workspaces (they will be the creator)
CREATE POLICY "Users can create workspaces" ON workspaces
  FOR INSERT WITH CHECK (auth.uid() = created_by);

-- Workspace admins can update their workspaces
CREATE POLICY "Admins can update workspaces" ON workspaces
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM workspace_members
      WHERE workspace_members.workspace_id = workspaces.id
      AND workspace_members.user_id = auth.uid()
      AND workspace_members.role = 'admin'
    )
  );

-- =============================================================================
-- RLS POLICIES FOR WORKSPACE MEMBERS
-- =============================================================================

-- Users can read members of workspaces they belong to
CREATE POLICY "Users can read workspace members" ON workspace_members
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM workspace_members AS wm
      WHERE wm.workspace_id = workspace_members.workspace_id
      AND wm.user_id = auth.uid()
    )
  );

-- Users can insert themselves as members (for workspace creation)
CREATE POLICY "Users can add themselves as members" ON workspace_members
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Admins can update members in their workspaces
CREATE POLICY "Admins can update workspace members" ON workspace_members
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM workspace_members AS wm
      WHERE wm.workspace_id = workspace_members.workspace_id
      AND wm.user_id = auth.uid()
      AND wm.role = 'admin'
    )
  );

-- =============================================================================
-- RLS POLICIES FOR PROFILES
-- =============================================================================

-- Users can read all profiles (for displaying member names)
CREATE POLICY "Users can read all profiles" ON profiles
  FOR SELECT USING (true);

-- Users can only update their own profile
CREATE POLICY "Users can update own profile" ON profiles
  FOR UPDATE USING (auth.uid() = id);

-- Users can insert their own profile
CREATE POLICY "Users can insert own profile" ON profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

-- =============================================================================
-- RLS POLICIES FOR ONBOARDING STATUS
-- =============================================================================

-- Users can read their own onboarding status
CREATE POLICY "Users can read own onboarding status" ON onboarding_status
  FOR SELECT USING (auth.uid() = user_id);

-- Users can update their own onboarding status
CREATE POLICY "Users can update own onboarding status" ON onboarding_status
  FOR UPDATE USING (auth.uid() = user_id);

-- Users can insert their own onboarding status
CREATE POLICY "Users can insert own onboarding status" ON onboarding_status
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- =============================================================================
-- TRIGGER: Auto-create profile and onboarding_status on user signup
-- =============================================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  -- Create profile for new user
  INSERT INTO public.profiles (id, full_name, avatar_url)
  VALUES (NEW.id, NULL, NULL);
  
  -- Create onboarding status for new user (not completed, no workspace)
  INSERT INTO public.onboarding_status (user_id, completed, workspace_id)
  VALUES (NEW.id, FALSE, NULL);
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop trigger if exists and recreate
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
