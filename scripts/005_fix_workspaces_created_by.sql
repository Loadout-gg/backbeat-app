-- Migration: Auto-set created_by on workspace insert via trigger
-- This removes the need for the client to pass created_by and simplifies RLS

-- 1. Create trigger function to automatically set created_by = auth.uid()
CREATE OR REPLACE FUNCTION public.set_workspace_created_by()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NEW.created_by IS NULL THEN
    NEW.created_by := auth.uid();
  END IF;
  RETURN NEW;
END;
$$;

-- 2. Create BEFORE INSERT trigger on workspaces
DROP TRIGGER IF EXISTS set_workspace_created_by_trigger ON public.workspaces;

CREATE TRIGGER set_workspace_created_by_trigger
BEFORE INSERT ON public.workspaces
FOR EACH ROW
EXECUTE FUNCTION public.set_workspace_created_by();

-- 3. Update INSERT policy to only check authentication (not created_by match)
ALTER POLICY workspaces_insert_own
ON public.workspaces
WITH CHECK (auth.uid() IS NOT NULL);
