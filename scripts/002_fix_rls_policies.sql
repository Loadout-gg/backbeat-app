-- Fix infinite recursion in RLS policies
-- This script drops the problematic policies and recreates them correctly

-- =============================================================================
-- DROP EXISTING POLICIES THAT CAUSE RECURSION
-- =============================================================================

DROP POLICY IF EXISTS "Users can read their workspaces" ON workspaces;
DROP POLICY IF EXISTS "Admins can update workspaces" ON workspaces;
DROP POLICY IF EXISTS "Users can read workspace members" ON workspace_members;
DROP POLICY IF EXISTS "Admins can update workspace members" ON workspace_members;
DROP POLICY IF EXISTS "Users can insert workspace members" ON workspace_members;

-- =============================================================================
-- WORKSPACE_MEMBERS POLICIES (define first - no self-reference!)
-- =============================================================================

-- SELECT: Users can ONLY see their own membership rows (breaks recursion)
CREATE POLICY "Users can read workspace members" ON workspace_members
  FOR SELECT USING (user_id = auth.uid());

-- INSERT: Users can add themselves to any workspace
CREATE POLICY "Users can insert workspace members" ON workspace_members
  FOR INSERT WITH CHECK (user_id = auth.uid());

-- UPDATE: Admins can update members (uses simple self-check now)
CREATE POLICY "Admins can update workspace members" ON workspace_members
  FOR UPDATE USING (user_id = auth.uid() AND role = 'admin');

-- =============================================================================
-- WORKSPACE POLICIES (can now safely reference workspace_members)
-- =============================================================================

-- SELECT: Users can read workspaces they are members of
CREATE POLICY "Users can read their workspaces" ON workspaces
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM workspace_members 
      WHERE workspace_members.workspace_id = workspaces.id 
        AND workspace_members.user_id = auth.uid()
    )
  );

-- UPDATE: Workspace admins can update their workspaces
CREATE POLICY "Admins can update workspaces" ON workspaces
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM workspace_members 
      WHERE workspace_members.workspace_id = workspaces.id 
        AND workspace_members.user_id = auth.uid() 
        AND workspace_members.role = 'admin'
    )
  );
