import { beforeEach, expect, it, vi } from "vitest"
const { db, query, workspace } = vi.hoisted(() => {
  const query: Record<string, ReturnType<typeof vi.fn>> = {}
  for (const method of ["insert", "update", "delete", "select", "eq", "single", "order"]) query[method] = vi.fn()
  return { query, workspace: vi.fn(async () => "selected-workspace"), db: { from: vi.fn(), auth: { getUser: vi.fn() } } }
})
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => db) }))
vi.mock("@/lib/actions/workspace", () => ({ getCurrentWorkspaceId: workspace }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
import { createBooking, updateBooking, updateBookingStatus, deleteBooking, getBookings, getBooking } from "@/lib/actions/bookings"
const id = "11111111-1111-4111-8111-111111111111"
const input = { artistId: id, date: "2026-10-12", startTime: "19:00", durationMinutes: 60 }
beforeEach(() => {
  db.auth.getUser.mockResolvedValue({ data: { user: { id: "user-a" } } })
  db.from.mockReturnValue(query)
  for (const method of Object.values(query)) method.mockReturnValue(query)
  query.single.mockResolvedValue({ data: { id, workspace_id: "wrong-workspace" }, error: null })
  query.order.mockResolvedValue({ data: [], error: null })
})
it("creates in the authoritative selected workspace rather than arbitrary membership", async () => {
  await createBooking(input)
  expect(query.insert).toHaveBeenCalledWith(expect.objectContaining({ workspace_id: "selected-workspace" }))
  expect(workspace).toHaveBeenCalledOnce()
})
it.each([
  ["list", () => getBookings()], ["get", () => getBooking(id)],
  ["update", () => updateBooking(id, { notes: "Changed" })],
  ["status", () => updateBookingStatus(id, "confirmed")],
  ["delete", () => deleteBooking(id)],
])("scopes %s to the authoritative workspace", async (_label, action) => {
  await action()
  expect(workspace).toHaveBeenCalledOnce()
  expect(query.eq).toHaveBeenCalledWith("workspace_id", "selected-workspace")
})
it.each([
  { artistId: "" }, { artistId: "not-a-uuid" }, { date: "2026-02-30" }, { date: "bad" },
  { startTime: "25:00" }, { startTime: "12:60" }, { durationMinutes: -1 },
  { durationMinutes: Number.NaN }, { durationMinutes: 1.5 },
])("rejects invalid creation input %j before backend access", async (patch) => {
  const result = await createBooking({ ...input, ...patch })
  expect(result.success).toBe(false)
  expect(result.error).toBeTruthy()
  expect(db.from).not.toHaveBeenCalled()
  expect(db.auth.getUser).not.toHaveBeenCalled()
})
it.each([
  { date: "2026-02-30" }, { start_time: "25:00" }, { duration_minutes: -2 },
  { status: "pending" },
])("rejects invalid update %j before backend access", async (patch) => {
  const result = await updateBooking(id, patch as Parameters<typeof updateBooking>[1])
  expect(result.success).toBe(false)
  expect(db.from).not.toHaveBeenCalled()
})
it("rejects obsolete pending status before backend access", async () => {
  const result = await updateBookingStatus(id, "pending" as Parameters<typeof updateBookingStatus>[1])
  expect(result.success).toBe(false)
  expect(db.from).not.toHaveBeenCalled()
})
it.each(["in_progress", "confirmed", "cancelled", "completed"] as const)("accepts approved status %s (characterization)", async (status) => {
  expect((await updateBookingStatus(id, status as Parameters<typeof updateBookingStatus>[1])).success).toBe(true)
  expect(query.update).toHaveBeenCalledWith(expect.objectContaining({ status }))
})
it.each([
  ["update", () => updateBooking(id, { notes: "changed" })],
  ["status", () => updateBookingStatus(id, "confirmed")],
  ["delete", () => deleteBooking(id)],
])("reports missing or out-of-workspace %s instead of false success", async (_label, action) => {
  query.single.mockResolvedValue({ data: null, error: null })
  expect(await action()).toEqual({ success: false, error: "Booking not found" })
})
it.each([
  ["update", () => updateBooking("bad-id", { notes: "changed" })],
  ["status", () => updateBookingStatus("bad-id", "confirmed")],
  ["delete", () => deleteBooking("bad-id")],
])("rejects malformed %s identifiers before backend access", async (_label, action) => {
  expect((await action()).success).toBe(false)
  expect(db.from).not.toHaveBeenCalled()
})
