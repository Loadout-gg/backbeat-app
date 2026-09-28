import { beforeEach, expect, it, vi } from "vitest"
const { db, queries } = vi.hoisted(() => ({ db: { auth: { getUser: vi.fn() }, from: vi.fn() }, queries: {} as Record<string, Record<string, ReturnType<typeof vi.fn>>> }))
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => db) }))
vi.mock("next/navigation", () => ({ redirect: vi.fn(() => { throw new Error("redirect") }) }))
import { getCurrentWorkspaceId } from "@/lib/actions/workspace"
beforeEach(() => {
  db.auth.getUser.mockResolvedValue({ data: { user: { id: "user-a" } } })
  for (const table of ["onboarding_status", "workspace_members"]) {
    const q: Record<string, ReturnType<typeof vi.fn>> = {}
    for (const method of ["select", "eq", "single"]) q[method] = vi.fn(() => q)
    queries[table] = q
  }
  queries.onboarding_status.single.mockResolvedValue({ data: { workspace_id: "workspace-a" }, error: null })
  queries.workspace_members.single.mockResolvedValue({ data: null, error: null })
  db.from.mockImplementation((table: string) => queries[table])
})
it("rejects a selected workspace without active membership", async () => {
  await expect(getCurrentWorkspaceId()).rejects.toThrow("No active workspace membership")
  expect(queries.workspace_members.eq.mock.calls).toEqual([["workspace_id", "workspace-a"], ["user_id", "user-a"], ["status", "active"]])
})
it("resolves the selected active membership (characterization)", async () => {
  queries.workspace_members.single.mockResolvedValue({ data: { workspace_id: "workspace-a" }, error: null })
  expect(await getCurrentWorkspaceId()).toBe("workspace-a")
})
it("fails closed on membership lookup error (characterization)", async () => {
  queries.workspace_members.single.mockResolvedValue({ data: null, error: { message: "unavailable" } })
  await expect(getCurrentWorkspaceId()).rejects.toThrow("No active workspace membership")
})
