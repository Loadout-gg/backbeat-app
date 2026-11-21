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
function profileUpdate(result: { data: unknown; error: { message: string } | null }) {
  const select = vi.fn(async () => result)
  const eq = vi.fn(() => ({ select }))
  const update = vi.fn(() => ({ eq }))
  db.from.mockReturnValue({ update })
  return { update, eq, select }
}
it("updateProfile keeps legacy full name intact, without splitting names (characterization)", async () => {
  const { update, eq, select } = profileUpdate({ data: [{ id: "actor" }], error: null })
  expect(await updateProfile("Legacy Unsplit Name")).toEqual({ success: true })
  expect(db.from).toHaveBeenCalledWith("profiles")
  expect(update).toHaveBeenCalledWith({ full_name: "Legacy Unsplit Name" })
  expect(eq).toHaveBeenCalledWith("id", "actor")
  expect(select).toHaveBeenCalledWith("id")
})
it("updateProfile stores the trimmed name", async () => {
  const { update } = profileUpdate({ data: [{ id: "actor" }], error: null })
  expect(await updateProfile("  Ada Lovelace  ")).toEqual({ success: true })
  expect(update).toHaveBeenCalledWith({ full_name: "Ada Lovelace" })
})
it.each(["", "   ", "a".repeat(201), "bad\nname", "tab\tname", null, 7])("updateProfile rejects invalid name %j before any write", async (name) => {
  await expect(updateProfile(name as string)).rejects.toThrow("Full name must be 1–200 characters")
  expect(db.auth.getUser).not.toHaveBeenCalled()
  expect(db.from).not.toHaveBeenCalled()
})
it("updateProfile accepts a 200-character name", async () => {
  const { update } = profileUpdate({ data: [{ id: "actor" }], error: null })
  expect(await updateProfile("a".repeat(200))).toEqual({ success: true })
  expect(update).toHaveBeenCalledWith({ full_name: "a".repeat(200) })
})
it.each([[[]], [null], [[{ id: "someone-else" }]], [[{ id: "actor" }, { id: "actor" }]]])("updateProfile fails when the actor's own row is not returned: %j", async (data) => {
  profileUpdate({ data, error: null })
  await expect(updateProfile("Ada Lovelace")).rejects.toThrow("Unable to save your name")
})
it("updateProfile rejects when not authenticated", async () => {
  db.auth.getUser.mockResolvedValue({ data: { user: null } })
  await expect(updateProfile("Ada Lovelace")).rejects.toThrow("Not authenticated")
  expect(db.from).not.toHaveBeenCalled()
})
