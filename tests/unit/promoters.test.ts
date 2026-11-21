import { beforeEach, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => {
  const state = { result: { data: null as unknown, error: null as { message: string } | null, count: null as number | null } }
  const query: Record<string, ReturnType<typeof vi.fn>> & { then?: unknown } = {}
  return { state, query, from: vi.fn(), createClient: vi.fn(), workspace: vi.fn(), revalidatePath: vi.fn() }
})
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }))
vi.mock("@/lib/actions/workspace", () => ({ getCurrentWorkspaceId: mocks.workspace }))
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }))
import { createPromoter, deletePromoter, getPromoter, listPromoterDirectory, updatePromoter } from "@/lib/actions/promoters"

const ID = "11111111-1111-4111-8111-111111111111"
const row = { id: ID, name: "Marta Rossi", company_name: "Nightwave Srl" }
beforeEach(() => {
  vi.clearAllMocks()
  mocks.state.result = { data: null, error: null, count: null }
  for (const method of ["select", "insert", "update", "delete", "eq", "order", "range", "single", "maybeSingle"]) {
    mocks.query[method] = vi.fn(() => mocks.query)
  }
  ;(mocks.query as { then: unknown }).then = (resolve: (value: unknown) => unknown) => Promise.resolve(mocks.state.result).then(resolve)
  mocks.from.mockReturnValue(mocks.query)
  mocks.createClient.mockResolvedValue({ from: mocks.from })
  mocks.workspace.mockResolvedValue("selected-workspace")
})

it("lists the workspace directory with explicit fields, ordered by name then id, without notes", async () => {
  mocks.state.result = { data: [{ ...row, email: "m@example.com", phone: null, notes: "private", workspace_id: "x" }], error: null, count: 1 }
  expect(await listPromoterDirectory()).toEqual([{ ...row, email: "m@example.com", phone: null }])
  expect(mocks.from).toHaveBeenCalledWith("promoters")
  expect(mocks.query.select).toHaveBeenCalledWith("id,name,company_name,email,phone", { count: "exact" })
  expect(mocks.query.eq.mock.calls).toEqual([["workspace_id", "selected-workspace"]])
  expect(mocks.query.order.mock.calls).toEqual([["name", { ascending: true }], ["id", { ascending: true }]])
})

it("fails the directory read instead of returning an empty list", async () => {
  mocks.state.result = { data: null, error: { message: "private database detail" }, count: null }
  await expect(listPromoterDirectory()).rejects.toThrow()
})

it("reads one promoter scoped to the selected workspace", async () => {
  mocks.state.result = { data: { ...row, email: null, phone: null, notes: "Pays late", workspace_id: "x" }, error: null, count: null }
  expect(await getPromoter(ID)).toEqual({ ...row, email: null, phone: null, notes: "Pays late" })
  expect(mocks.query.eq.mock.calls).toEqual([["workspace_id", "selected-workspace"], ["id", ID]])
})

it("returns null for a malformed id without touching the backend, and for a missing row", async () => {
  expect(await getPromoter("not-a-uuid")).toBeNull()
  expect(mocks.createClient).not.toHaveBeenCalled()
  expect(await getPromoter(ID)).toBeNull()
})

it("throws a fixed message when the single read fails", async () => {
  mocks.state.result = { data: null, error: { message: "private database detail" }, count: null }
  await expect(getPromoter(ID)).rejects.toThrow("Unable to load the promoter.")
})

it("creates a validated promoter in the authoritative workspace, ignoring caller-supplied ownership", async () => {
  mocks.state.result = { data: row, error: null, count: null }
  const input = { name: "  Marta Rossi ", company_name: " Nightwave Srl ", email: "", workspace_id: "attacker", id: "forced" }
  expect(await createPromoter(input as never)).toEqual({ success: true, promoter: row })
  expect(mocks.query.insert).toHaveBeenCalledWith({
    name: "Marta Rossi", company_name: "Nightwave Srl", email: null, phone: null, notes: null, workspace_id: "selected-workspace",
  })
  expect(mocks.revalidatePath.mock.calls.map(call => call[0])).toEqual(["/dashboard/promoters", "/dashboard/events/new", "/dashboard/events"])
})

it("rejects invalid input before any backend access", async () => {
  expect(await createPromoter({ name: " " })).toEqual({ success: false, error: "Promoter name is required" })
  expect(await updatePromoter(ID, { name: "Marta", email: "nope" })).toEqual({ success: false, error: "Enter a valid email address" })
  expect(mocks.createClient).not.toHaveBeenCalled()
  expect(mocks.workspace).not.toHaveBeenCalled()
})

it.each([
  [{ data: null, error: { message: "private database detail" } }],
  [{ data: null, error: null }],
  [{ data: { ...row, id: "not-a-uuid" }, error: null }],
])("never shows the provider message when a create does not confirm: %j", async (result) => {
  mocks.state.result = { ...result, count: null }
  expect(await createPromoter({ name: "Marta" })).toEqual({ success: false, error: "Unable to save the promoter. Please try again." })
  expect(mocks.revalidatePath).not.toHaveBeenCalled()
})

it("updates only the targeted row of the selected workspace and requires it back", async () => {
  mocks.state.result = { data: [row], error: null, count: null }
  expect(await updatePromoter(ID, { name: "Marta Rossi", company_name: "Nightwave Srl", notes: "" })).toEqual({ success: true, promoter: row })
  expect(mocks.query.update).toHaveBeenCalledWith({ name: "Marta Rossi", company_name: "Nightwave Srl", email: null, phone: null, notes: null })
  expect(mocks.query.eq.mock.calls).toEqual([["workspace_id", "selected-workspace"], ["id", ID]])
  expect(mocks.revalidatePath).toHaveBeenCalledTimes(3)
})

it.each([
  [[], "Promoter not found."],
  [null, "Promoter not found."],
  [[{ ...row, id: "22222222-2222-4222-8222-222222222222" }], "Promoter not found."],
  [[row, row], "Promoter not found."],
])("does not report success when the update returns %j", async (data, error) => {
  mocks.state.result = { data, error: null, count: null }
  expect(await updatePromoter(ID, { name: "Marta" })).toEqual({ success: false, error })
  expect(mocks.revalidatePath).not.toHaveBeenCalled()
})

it("hides the provider message on a failed update and rejects a malformed id early", async () => {
  mocks.state.result = { data: null, error: { message: "private database detail" }, count: null }
  expect(await updatePromoter(ID, { name: "Marta" })).toEqual({ success: false, error: "Unable to save the promoter. Please try again." })
  mocks.createClient.mockClear()
  expect(await updatePromoter("not-a-uuid", { name: "Marta" })).toEqual({ success: false, error: "Promoter not found." })
  expect(mocks.createClient).not.toHaveBeenCalled()
})

it("deletes only the targeted row of the selected workspace and requires it back", async () => {
  mocks.state.result = { data: [{ id: ID }], error: null, count: null }
  expect(await deletePromoter(ID)).toEqual({ success: true })
  expect(mocks.from).toHaveBeenCalledWith("promoters")
  expect(mocks.query.delete).toHaveBeenCalledTimes(1)
  expect(mocks.query.eq.mock.calls).toEqual([["workspace_id", "selected-workspace"], ["id", ID]])
  expect(mocks.revalidatePath.mock.calls.map(call => call[0])).toEqual(["/dashboard/promoters", "/dashboard/events/new", "/dashboard/events", "/dashboard"])
})

it.each([[[]], [null], [[{ id: "22222222-2222-4222-8222-222222222222" }]], [[{ id: ID }, { id: ID }]]])("does not report a delete when the database returns %j", async (data) => {
  mocks.state.result = { data, error: null, count: null }
  expect(await deletePromoter(ID)).toEqual({ success: false, error: "Promoter not found." })
  expect(mocks.revalidatePath).not.toHaveBeenCalled()
})

it("hides the provider message on a failed delete and rejects a malformed id before backend access", async () => {
  mocks.state.result = { data: null, error: { message: "private database detail" }, count: null }
  expect(await deletePromoter(ID)).toEqual({ success: false, error: "Unable to delete the promoter. Please try again." })
  mocks.createClient.mockClear()
  expect(await deletePromoter("not-a-uuid")).toEqual({ success: false, error: "Promoter not found." })
  expect(mocks.createClient).not.toHaveBeenCalled()
})
