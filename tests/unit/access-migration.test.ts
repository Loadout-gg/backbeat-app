// STATIC source contracts only. These do not parse or execute PostgreSQL.
import { readFileSync, existsSync } from "node:fs"
import { expect, it } from "vitest"
const path = "migrations/003_access_foundation.sql"
const sql = () => existsSync(path) ? readFileSync(path, "utf8") : ""
it("STATIC: migration guards the exact synthetic singleton and refuses repeat/partial state", () => {
  expect(sql()).toContain("BEGIN;")
  expect(sql()).toContain("SET LOCAL lock_timeout")
  expect(sql()).toContain("SET LOCAL statement_timeout")
  expect(sql()).toContain("count(*) FROM public.runtime_environment) <> 1")
  expect(sql()).toContain("id = 'backbeat-dev' AND environment = 'development' AND synthetic_only IS TRUE")
  expect(sql()).toContain("relrowsecurity")
  expect(sql()).toContain("refusing repeat or partial")
})

it("STATIC: persists bounded string identity only in the app insert trigger without rewriting old profiles", () => {
  expect(sql()).toContain("ADD COLUMN first_name text")
  expect(sql()).toContain("ADD COLUMN last_name text")
  expect(sql()).toContain("pg_catalog.jsonb_typeof(NEW.raw_user_meta_data -> 'first_name') = 'string'")
  expect(sql()).toContain("pg_catalog.jsonb_typeof(NEW.raw_user_meta_data -> 'last_name') = 'string'")
  expect(sql()).toContain("CREATE OR REPLACE FUNCTION public.backbeat_handle_new_user()")
  expect(sql()).not.toMatch(/UPDATE public.profiles/i)
  expect(sql()).not.toMatch(/(?:CREATE|DROP) TRIGGER/i)
  expect(sql()).toContain("pg_catalog.char_length(first_name) BETWEEN 1 AND 100")
})

it("STATIC: bootstrap locks the confirmed actor and atomically selects or creates Master ownership", () => {
  for (const fragment of ["CREATE FUNCTION public.backbeat_bootstrap_workspace(workspace_name text)", "RETURNS uuid", "SET search_path = ''", "auth.uid()", "auth.role() IS DISTINCT FROM 'authenticated'", "email_confirmed_at IS NOT NULL", "pg_catalog.pg_advisory_xact_lock", "Ambiguous active memberships", "Inactive or pending membership", "Orphan owned workspace", "'master', 'active'", "ON CONFLICT (user_id) DO UPDATE", "GRANT EXECUTE ON FUNCTION public.backbeat_bootstrap_workspace(text) TO authenticated"])
    expect(sql(), fragment).toContain(fragment)
  expect(sql()).toContain("m.role = 'admin' AND m.status = 'active' AND w.created_by = m.user_id")
})

it("STATIC: closes legacy provisioning grants and policies without changing business policy", () => {
  for (const fragment of ["REVOKE INSERT ON public.workspaces, public.workspace_members FROM PUBLIC, anon, authenticated", "REVOKE UPDATE (completed, workspace_id) ON public.onboarding_status", "DROP POLICY workspace_insert ON public.workspaces", "DROP POLICY membership_bootstrap ON public.workspace_members", "DROP POLICY onboarding_update ON public.onboarding_status"])
    expect(sql(), fragment).toContain(fragment)
  expect(sql()).not.toMatch(/(?:DROP|CREATE) POLICY (?:artist|booking|event|promoter|workspace_update|workspace_delete)/)
})
