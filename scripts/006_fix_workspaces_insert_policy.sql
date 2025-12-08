-- Migration 006: Fix workspaces INSERT policy
-- The issue: RLS policy is blocking inserts because created_by check fails
-- Solution: Drop and recreate the policy to only check authentication

-- First, ensure the trigger function exists
CREATE OR REPLACE FUNCTION public.set_workspace_created_by()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  NEW.created_by := auth.uid();
  RETURN NEW;
END;
$$;

-- Ensure trigger exists
DROP TRIGGER IF EXISTS set_workspace_created_by_trigger ON public.workspaces;

CREATE TRIGGER set_workspace_created_by_trigger
BEFORE INSERT ON public.workspaces
FOR EACH ROW
EXECUTE FUNCTION public.set_workspace_created_by();

-- Drop the problematic INSERT policy
DROP POLICY IF EXISTS workspaces_insert_own ON public.workspaces;
DROP POLICY IF EXISTS "Users can create workspaces" ON public.workspaces;

-- Create a new INSERT policy that ONLY checks authentication
-- The trigger handles setting created_by automatically
CREATE POLICY workspaces_insert_authenticated
ON public.workspaces
FOR INSERT
TO authenticated
WITH CHECK (true);

-- Verify SELECT policy exists (users can read workspaces they're members of)
DROP POLICY IF EXISTS workspaces_select_members ON public.workspaces;

CREATE POLICY workspaces_select_members
ON public.workspaces
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.workspace_members wm
    WHERE wm.workspace_id = id
    AND wm.user_id = auth.uid()
  )
  OR created_by = auth.uid()
);
