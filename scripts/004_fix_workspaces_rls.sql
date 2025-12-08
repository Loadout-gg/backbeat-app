-- Fix RLS policies for public.workspaces ONLY
-- This migration drops ALL existing policies on workspaces and recreates them correctly
-- to allow the createWorkspace flow during onboarding

-- =============================================================================
-- STEP 1: Ensure RLS is enabled
-- =============================================================================
ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- STEP 2: Drop ALL existing policies on workspaces (by any name)
-- =============================================================================
DO $$
DECLARE
  pol RECORD;
BEGIN
  FOR pol IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'workspaces'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.workspaces', pol.policyname);
  END LOOP;
END
$$;

-- =============================================================================
-- STEP 3: Create clean, correct policies
-- =============================================================================

-- INSERT: Any authenticated user can create a workspace where they are the creator
-- This allows createWorkspace to insert BEFORE the user is a member
CREATE POLICY workspaces_insert_own
ON public.workspaces
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() IS NOT NULL
  AND created_by = auth.uid()
);

-- SELECT: Users can see workspaces where they are a member
-- This uses EXISTS on workspace_members which has its own non-recursive SELECT policy
CREATE POLICY workspaces_select_members
ON public.workspaces
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.workspace_members wm
    WHERE wm.workspace_id = id
      AND wm.user_id = auth.uid()
  )
);

-- UPDATE: Only admins can update workspaces
CREATE POLICY workspaces_update_admin
ON public.workspaces
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.workspace_members wm
    WHERE wm.workspace_id = id
      AND wm.user_id = auth.uid()
      AND wm.role = 'admin'
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.workspace_members wm
    WHERE wm.workspace_id = id
      AND wm.user_id = auth.uid()
      AND wm.role = 'admin'
  )
);

-- DELETE: Only admins can delete workspaces (optional, matches UPDATE semantics)
CREATE POLICY workspaces_delete_admin
ON public.workspaces
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.workspace_members wm
    WHERE wm.workspace_id = id
      AND wm.user_id = auth.uid()
      AND wm.role = 'admin'
  )
);
