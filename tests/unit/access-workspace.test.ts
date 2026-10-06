import { beforeEach, expect, it, vi } from "vitest"
const { db } = vi.hoisted(() => ({ db: { auth: { getUser: vi.fn() }, rpc: vi.fn(), from: vi.fn() } }))
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => db) }))
vi.mock("next/navigation", () => ({ redirect: vi.fn() }))
import { createWorkspace, getCurrentUser, updateProfile } from "@/lib/actions/workspace"
const workspaceId = "11111111-1111-4111-8111-111111111111"
beforeEach(() => {
  db.auth.getUser.mockResolvedValue({ data: { user: { id: "actor" } } })
  db.rpc.mockResolvedValue({ data: workspaceId, error: null })
  // Legacy API is intentionally functional so RED identifies the missing RPC behavior.
  const query: Record<string, ReturnType<typeof vi.fn>> = {}
  for (const method of ["insert", "update", "eq"]) query[method] = vi.fn(() => query)
  query.select = vi.fn(async () => ({ data: [{ id: workspaceId }], error: null }))
  db.from.mockReturnValue(query)
})
it("bootstraps through the atomic RPC, preserving the public return contract", async () => {
  expect(await createWorkspace("  Studio  ")).toEqual({ success: true, workspaceId })
  expect(db.rpc).toHaveBeenCalledWith("backbeat_bootstrap_workspace", { workspace_name: "Studio" })
  expect(db.from).not.toHaveBeenCalled()
})

it.each(["", "   ", "a".repeat(201), "bad\nname", null, 7])("rejects invalid workspace input %j before provisioning", async (name) => {
  await expect(createWorkspace(name as string)).rejects.toThrow("Workspace name")
  expect(db.rpc).not.toHaveBeenCalled()
})

it.each([null, "", "not-a-uuid", [], { id: workspaceId }])("rejects invalid RPC UUID %j", async (data) => {
  db.rpc.mockResolvedValue({ data, error: null })
  await expect(createWorkspace("Studio")).rejects.toThrow("Unable to create workspace")
})
it("rejects unauthenticated provisioning (characterization)", async () => {
  db.auth.getUser.mockResolvedValue({ data: { user: null } })
  await expect(createWorkspace("Studio")).rejects.toThrow("Not authenticated")
  expect(db.rpc).not.toHaveBeenCalled()
})
it("does not leak provider failure details (characterization)", async () => {
  db.rpc.mockResolvedValue({ data: null, error: { message: "private database details" } })
  await expect(createWorkspace("Studio")).rejects.toThrow("Unable to create workspace. Please try again.")
})

it("fails closed if Auth returns a user together with an error", async () => {
  db.auth.getUser.mockResolvedValue({ data: { user: { id: "actor" } }, error: { message: "invalid session" } })
  await expect(createWorkspace("Studio")).rejects.toThrow("Not authenticated")
  expect(db.rpc).not.toHaveBeenCalled()
})

it("returns a safe retryable error when the RPC transport throws", async () => {
  db.rpc.mockRejectedValue(new Error("private transport details"))
  await expect(createWorkspace("Studio")).rejects.toThrow("Unable to create workspace. Please try again.")
})

it("getCurrentUser preserves identity and onboarding shape including separate names (characterization)", async () => {
  const profile = { id: "actor", full_name: "Ada Lovelace", first_name: "Ada", last_name: "Lovelace", avatar_url: null }
  const workspace = { id: workspaceId, name: "Studio" }
  const onboardingStatus = { completed: true, workspace_id: workspaceId, workspaces: workspace }
  db.from.mockImplementation((table) => {
    const q = { select: vi.fn(), eq: vi.fn(), single: vi.fn(async () => ({ data: table === "profiles" ? profile : onboardingStatus })) }
    q.select.mockReturnValue(q); q.eq.mockReturnValue(q)
    return q
  })
  expect(await getCurrentUser()).toEqual({ user: { id: "actor" }, profile, onboardingStatus, workspace })
})
it("updateProfile keeps legacy full name intact, without splitting names (characterization)", async () => {
  const eq = vi.fn(async () => ({ error: null }))
  const update = vi.fn(() => ({ eq }))
  db.from.mockReturnValue({ update })
  expect(await updateProfile("Legacy Unsplit Name")).toEqual({ success: true })
  expect(update).toHaveBeenCalledWith({ full_name: "Legacy Unsplit Name" })
  expect(eq).toHaveBeenCalledWith("id", "actor")
})
