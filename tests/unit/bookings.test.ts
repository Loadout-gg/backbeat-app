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
import { revalidatePath } from "next/cache"
const id = "11111111-1111-4111-8111-111111111111"
const input = { artistId: id, date: "2026-10-12", startTime: "19:00", durationMinutes: 60 }
beforeEach(() => {
  db.auth.getUser.mockResolvedValue({ data: { user: { id: "user-a" } } })
  db.from.mockReturnValue(query)
  for (const method of Object.values(query)) method.mockReturnValue(query)
  query.single.mockResolvedValue({ data: { id, workspace_id: "wrong-workspace" }, error: null })
  query.order.mockResolvedValue({ data: [], error: null })
})
it.each([
  ["create", () => createBooking(input)],
  ["update", () => updateBooking(id, { notes: "Updated" })],
  ["status", () => updateBookingStatus(id, "confirmed")],
  ["delete", () => deleteBooking(id)],
])("invalidates the new booking list after %s", async (_label, action) => {
  await action()
  expect(revalidatePath).toHaveBeenCalledWith("/dashboard/bookings")
})
it("filters an artist booking query inside the authoritative workspace", async () => {
  await getBookings({ artistId: id })
  expect(query.eq).toHaveBeenCalledWith("workspace_id", "selected-workspace")
  expect(query.eq).toHaveBeenCalledWith("artist_id", id)
})
it("reports strict booking-read failure instead of a false empty list", async () => {
  query.order.mockResolvedValueOnce({ data: null, error: { message: "backend unavailable" } })
  const log = vi.spyOn(console, "error").mockImplementation(() => {})
  try {
    await expect(getBookings({ failOnError: true })).rejects.toThrow("Unable to load bookings")
  } finally { log.mockRestore() }
})
it.each(["", "not-an-artist-id"])("rejects malformed artist filter %j before backend access", async (artistId) => {
  await expect(getBookings({ artistId })).rejects.toThrow("Invalid artist ID")
  expect(db.from).not.toHaveBeenCalled()
  expect(db.auth.getUser).not.toHaveBeenCalled()
})
it("does not report an empty strict list after the session expires", async () => {
  db.auth.getUser.mockResolvedValueOnce({ data: { user: null } })
  await expect(getBookings({ failOnError: true })).rejects.toThrow("Not authenticated")
  expect(db.from).not.toHaveBeenCalled()
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

const details = { venue_name: " Studio A ", venue_address: " 1 Synthetic Road ", contact_name_main: " Demo Contact ", contact_phone_main: " +39 (06) 123 ext. 4 ", contact_email_main: " demo@example.test " }
it("persists normalized venue and primary contact only inside the current workspace", async () => {
  expect(await updateBooking(id, details)).toEqual({ success: true })
  expect(query.update).toHaveBeenCalledWith(expect.objectContaining(Object.fromEntries(Object.entries(details).map(([key, value]) => [key, value.trim()]))))
  expect(query.eq).toHaveBeenCalledWith("workspace_id", "selected-workspace")
  expect(query.eq).toHaveBeenCalledWith("id", id)
})
it.each(["", "   ", null])("clears all explicit M2 fields set to %j", async value => {
  const cleared = Object.fromEntries(Object.keys(details).map(key => [key, value]))
  expect((await updateBooking(id, cleared)).success).toBe(true)
  expect(query.update).toHaveBeenCalledWith(expect.objectContaining(Object.fromEntries(Object.keys(details).map(key => [key, null]))))
})
it("leaves omitted M2 values untouched and never persists unsupported placeholders", async () => {
  await updateBooking(id, { notes: "Changed note", venue_name: undefined, driver_name: "Unsupported" })
  const payload = query.update.mock.calls[0][0]
  for (const key of [...Object.keys(details), "driver_name"]) expect(payload).not.toHaveProperty(key)
  expect(payload.notes).toBe("Changed note")
})

it.each([
  { venue_name: "x".repeat(201) }, { venue_address: "x".repeat(1001) },
  { contact_name_main: "x".repeat(201) }, { contact_phone_main: "x".repeat(101) },
  { contact_email_main: "x".repeat(255) }, { contact_email_main: "not-an-email" },
])("rejects invalid M2 detail input before backend access: %j", async input => {
  expect((await updateBooking(id, input)).success).toBe(false)
  expect(db.from).not.toHaveBeenCalled()
  expect(db.auth.getUser).not.toHaveBeenCalled()
})

it("reschedules only the current-workspace booking and invalidates its views", async () => {
  expect(await updateBooking(id, { date: "2026-10-26" })).toEqual({ success: true })
  expect(query.update).toHaveBeenCalledWith({ date: "2026-10-26", updated_at: expect.any(String) })
  expect(query.eq).toHaveBeenCalledWith("id", id)
  expect(query.eq).toHaveBeenCalledWith("workspace_id", "selected-workspace")
  for (const path of ["/dashboard", "/dashboard/bookings", `/dashboard/bookings/${id}`]) {
    expect(revalidatePath).toHaveBeenCalledWith(path)
  }
})
