import { beforeEach, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => {
  const state = { result: { data: null as unknown, error: null as { message: string } | null } }
  const query: Record<string, ReturnType<typeof vi.fn>> & { then?: unknown } = {}
  return { state, query, from: vi.fn(), createClient: vi.fn(), workspace: vi.fn(), revalidatePath: vi.fn() }
})
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }))
vi.mock("@/lib/actions/workspace", () => ({ getCurrentWorkspaceId: mocks.workspace }))
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }))
import { deleteEvent, getEvent, updateEvent } from "@/lib/actions/events"

const ID = "11111111-1111-4111-8111-111111111111"
const ARTIST = "22222222-2222-4222-8222-222222222222"
const PROMOTER = "33333333-3333-4333-8333-333333333333"
const valid = { title: "Synthetic Night", date: "2030-03-01", status: "confirmed" as const }
beforeEach(() => {
  vi.clearAllMocks()
  mocks.state.result = { data: null, error: null }
  for (const method of ["select", "update", "delete", "eq", "maybeSingle"]) mocks.query[method] = vi.fn(() => mocks.query)
  ;(mocks.query as { then: unknown }).then = (resolve: (value: unknown) => unknown) => Promise.resolve(mocks.state.result).then(resolve)
  mocks.from.mockReturnValue(mocks.query)
  mocks.createClient.mockResolvedValue({ from: mocks.from })
  mocks.workspace.mockResolvedValue("selected-workspace")
})

it("reads one event scoped to the selected workspace with explicit fields only", async () => {
  mocks.state.result = {
    data: { id: ID, title: "Synthetic Night", date: "2030-03-01", location: null, status: "confirmed", artist_id: ARTIST, promoter_id: null, workspace_id: "x", public_token: "secret" },
    error: null,
  }
  expect(await getEvent(ID)).toEqual({ id: ID, title: "Synthetic Night", date: "2030-03-01", location: null, status: "confirmed", artist_id: ARTIST, promoter_id: null })
  expect(mocks.from).toHaveBeenCalledWith("events")
  expect(mocks.query.select).toHaveBeenCalledWith("id,title,date,location,status,artist_id,promoter_id")
  expect(mocks.query.eq.mock.calls).toEqual([["workspace_id", "selected-workspace"], ["id", ID]])
})

it("returns null for a malformed id without backend access, and for a missing row", async () => {
  expect(await getEvent("not-a-uuid")).toBeNull()
  expect(mocks.createClient).not.toHaveBeenCalled()
  expect(await getEvent(ID)).toBeNull()
})

it("throws a fixed message when the read fails", async () => {
  mocks.state.result = { data: null, error: { message: "private database detail" } }
  await expect(getEvent(ID)).rejects.toThrow("Unable to load the event.")
})

it("updates only the targeted event of the selected workspace with validated values", async () => {
  mocks.state.result = { data: [{ id: ID }], error: null }
  const input = { ...valid, title: "  Synthetic Night ", location: " Rome ", artist_id: ARTIST, promoter_id: PROMOTER, workspace_id: "attacker", public_token: "x" }
  expect(await updateEvent(ID, input as never)).toEqual({ success: true })
  expect(mocks.query.update).toHaveBeenCalledWith({
    title: "Synthetic Night", date: "2030-03-01", location: "Rome", status: "confirmed", artist_id: ARTIST, promoter_id: PROMOTER,
  })
  expect(mocks.query.eq.mock.calls).toEqual([["workspace_id", "selected-workspace"], ["id", ID]])
  expect(mocks.revalidatePath.mock.calls.map(call => call[0])).toEqual(["/dashboard/events", `/dashboard/events/${ID}`, "/dashboard", "/dashboard/artists"])
})

it("clears location, artist and promoter when they are blank, null or omitted", async () => {
  mocks.state.result = { data: [{ id: ID }], error: null }
  await updateEvent(ID, { ...valid, location: "  ", artist_id: null })
  expect(mocks.query.update).toHaveBeenCalledWith({
    title: "Synthetic Night", date: "2030-03-01", location: null, status: "confirmed", artist_id: null, promoter_id: null,
  })
})

it.each([
  [{ ...valid, title: "  " }, "Event title is required"],
  [{ ...valid, date: "2030-02-30" }, "Enter a valid event date"],
  [{ ...valid, date: "0000-01-01" }, "Enter a valid event date"],
  [{ ...valid, status: "completed" }, "Choose a valid status"],
  [{ title: "Synthetic Night", date: "2030-03-01" }, "Choose a valid status"],
  [{ ...valid, artist_id: "nope" }, "Choose a valid artist"],
  [{ ...valid, promoter_id: "nope" }, "Choose a valid promoter"],
])("rejects %j before any backend access", async (input, error) => {
  expect(await updateEvent(ID, input as never)).toEqual({ success: false, error })
  expect(mocks.createClient).not.toHaveBeenCalled()
})

it.each([[[]], [null], [[{ id: ARTIST }]], [[{ id: ID }, { id: ID }]]])("does not report success when the update returns %j", async (data) => {
  mocks.state.result = { data, error: null }
  expect(await updateEvent(ID, valid)).toEqual({ success: false, error: "Event not found." })
  expect(mocks.revalidatePath).not.toHaveBeenCalled()
})

it("hides the provider message on a failed update and rejects a malformed id early", async () => {
  mocks.state.result = { data: null, error: { message: "private database detail" } }
  expect(await updateEvent(ID, valid)).toEqual({ success: false, error: "Unable to save the event. Please try again." })
  mocks.createClient.mockClear()
  expect(await updateEvent("not-a-uuid", valid)).toEqual({ success: false, error: "Event not found." })
  expect(mocks.createClient).not.toHaveBeenCalled()
})

it("deletes only the targeted event of the selected workspace and requires it back", async () => {
  mocks.state.result = { data: [{ id: ID }], error: null }
  expect(await deleteEvent(ID)).toEqual({ success: true })
  expect(mocks.from).toHaveBeenCalledWith("events")
  expect(mocks.query.delete).toHaveBeenCalledTimes(1)
  expect(mocks.query.eq.mock.calls).toEqual([["workspace_id", "selected-workspace"], ["id", ID]])
  expect(mocks.revalidatePath.mock.calls.map(call => call[0])).toEqual(["/dashboard/events", "/dashboard", "/dashboard/artists"])
})

it.each([[[]], [null], [[{ id: ARTIST }]], [[{ id: ID }, { id: ID }]]])("does not report a delete when the database returns %j", async (data) => {
  mocks.state.result = { data, error: null }
  expect(await deleteEvent(ID)).toEqual({ success: false, error: "Event not found." })
  expect(mocks.revalidatePath).not.toHaveBeenCalled()
})

it("hides the provider message on a failed delete and rejects a malformed id before backend access", async () => {
  mocks.state.result = { data: null, error: { message: "private database detail" } }
  expect(await deleteEvent(ID)).toEqual({ success: false, error: "Unable to delete the event. Please try again." })
  mocks.createClient.mockClear()
  expect(await deleteEvent("not-a-uuid")).toEqual({ success: false, error: "Event not found." })
  expect(mocks.createClient).not.toHaveBeenCalled()
})
