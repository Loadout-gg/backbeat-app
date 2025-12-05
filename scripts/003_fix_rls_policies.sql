-- Drop existing policies
DROP POLICY IF EXISTS "workspaces_select" ON workspaces;
DROP POLICY IF EXISTS "workspaces_insert" ON workspaces;
DROP POLICY IF EXISTS "workspaces_update" ON workspaces;
DROP POLICY IF EXISTS "workspace_members_select" ON workspace_members;
DROP POLICY IF EXISTS "workspace_members_insert" ON workspace_members;
DROP POLICY IF EXISTS "workspace_members_update" ON workspace_members;

-- Enable RLS
ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_members ENABLE ROW LEVEL SECURITY;

-- WORKSPACES POLICIES
-- INSERT: Allow user to create workspace if they are the creator (no membership check)
CREATE POLICY "workspaces_insert" ON workspaces
  FOR INSERT
  WITH CHECK (created_by = auth.uid());

-- SELECT: Allow user to see workspaces where they are a member
CREATE POLICY "workspaces_select" ON workspaces
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM workspace_members m
      WHERE m.workspace_id = workspaces.id
      AND m.user_id = auth.uid()
    )
  );

-- UPDATE: Allow user to update workspaces where they are a member
CREATE POLICY "workspaces_update" ON workspaces
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM workspace_members m
      WHERE m.workspace_id = workspaces.id
      AND m.user_id = auth.uid()
    )
  );

-- WORKSPACE_MEMBERS POLICIES
-- INSERT: Allow user to insert their own membership
CREATE POLICY "workspace_members_insert" ON workspace_members
  FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- SELECT: Allow user to see only their own membership rows
CREATE POLICY "workspace_members_select" ON workspace_members
  FOR SELECT
  USING (user_id = auth.uid());

-- UPDATE: Allow user to update only their own membership rows
CREATE POLICY "workspace_members_update" ON workspace_members
  FOR UPDATE
  USING (user_id = auth.uid());
