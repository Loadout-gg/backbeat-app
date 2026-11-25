import { beforeEach, expect, it, vi } from "vitest"
const { db, query, workspace } = vi.hoisted(() => {
  const query: Record<string, ReturnType<typeof vi.fn>> = {}
  for (const method of ["insert", "update", "delete", "select", "eq", "lte", "single", "maybeSingle", "order", "range"]) query[method] = vi.fn()
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
  query.maybeSingle.mockResolvedValue({ data: { id }, error: null })
  query.range.mockResolvedValue({ data: [], count: 0, error: null })
})
it.each([
  ["create", () => createBooking(input)],
  ["update", () => updateBooking(id, { notes: "Updated" })],
  ["status", () => updateBookingStatus(id, "confirmed", "in_progress")],
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
  query.range.mockResolvedValueOnce({ data: null, count: null, error: { message: "backend unavailable" } })
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
  ["status", () => updateBookingStatus(id, "confirmed", "in_progress")],
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
  { status: "pending" }, { status: "confirmed" }, { hold_expires_on: "2026-02-30" },
])("rejects invalid update %j before backend access", async (patch) => {
  const result = await updateBooking(id, patch as Parameters<typeof updateBooking>[1])
  expect(result.success).toBe(false)
  expect(db.from).not.toHaveBeenCalled()
})
it("rejects obsolete pending status before backend access", async () => {
  const result = await updateBookingStatus(id, "pending" as Parameters<typeof updateBookingStatus>[1], "in_progress")
  expect(result.success).toBe(false)
  expect(db.from).not.toHaveBeenCalled()
  const stale = await updateBookingStatus(id, "confirmed", "pending" as Parameters<typeof updateBookingStatus>[2])
  expect(stale).toEqual({ success: false, error: "Invalid booking status" })
  expect(db.from).not.toHaveBeenCalled()
})
it.each([
  ["update", () => updateBooking(id, { notes: "changed" })],
  ["status", () => updateBookingStatus(id, "confirmed", "in_progress")],
  ["delete", () => deleteBooking(id)],
])("reports missing or out-of-workspace %s instead of false success", async (_label, action) => {
  query.maybeSingle.mockResolvedValue({ data: null, error: null })
  expect(await action()).toEqual({ success: false, error: "Booking not found" })
})
it.each([
  ["update", () => updateBooking("bad-id", { notes: "changed" })],
  ["status", () => updateBookingStatus("bad-id", "confirmed", "in_progress")],
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

it.each([
  { fee_amount_minor: 105000, fee_currency: "EUR" },
  { fee_amount_minor: 0, fee_currency: "GBP" },
  { fee_amount_minor: null, fee_currency: null },
])("persists only the scoped booking fee pair %j", async patch => {
  expect(await updateBooking(id, patch)).toEqual({ success: true })
  expect(query.update).toHaveBeenCalledWith({ ...patch, updated_at: expect.any(String) })
  expect(db.from).toHaveBeenCalledWith("bookings")
  expect(db.from).not.toHaveBeenCalledWith("artists")
  expect(query.eq).toHaveBeenCalledWith("workspace_id", "selected-workspace")
  expect(query.eq).toHaveBeenCalledWith("id", id)
})
it("leaves fee columns out of unrelated patches", async () => {
  await updateBooking(id, { notes: "Changed" })
  expect(query.update.mock.calls[0][0]).not.toHaveProperty("fee_amount_minor")
  expect(query.update.mock.calls[0][0]).not.toHaveProperty("fee_currency")
})
it.each([
  { fee_amount_minor: 100 }, { fee_currency: "EUR" },
  { fee_amount_minor: -1, fee_currency: "EUR" },
])("rejects malformed fee patch before authentication/backend access: %j", async patch => {
  expect((await updateBooking(id, patch)).success).toBe(false)
  expect(db.auth.getUser).not.toHaveBeenCalled()
  expect(db.from).not.toHaveBeenCalled()
})

// P1 lifecycle: transition graph, compare-and-set, fixed error copy.
const STATUSES = ["in_progress", "hold", "option", "confirmed", "cancelled", "completed"] as const
const ALLOWED = new Set([
  "in_progress>hold", "in_progress>option", "in_progress>confirmed", "in_progress>cancelled",
  "hold>option", "hold>confirmed", "hold>cancelled", "hold>in_progress",
  "option>confirmed", "option>cancelled", "option>hold",
  "confirmed>cancelled", "confirmed>completed", "cancelled>in_progress",
])
const pairs = STATUSES.flatMap(from => STATUSES.map(to => [from, to] as const))
it.each(pairs.filter(([from, to]) => ALLOWED.has(`${from}>${to}`)))("allows %s -> %s with a compare-and-set write", async (from, to) => {
  expect(await updateBookingStatus(id, to, from)).toEqual({ success: true })
  expect(query.update).toHaveBeenCalledWith({ status: to, updated_at: expect.any(String) })
  expect(query.eq).toHaveBeenCalledWith("id", id)
  expect(query.eq).toHaveBeenCalledWith("workspace_id", "selected-workspace")
  expect(query.eq).toHaveBeenCalledWith("status", from)
  expect(revalidatePath).toHaveBeenCalledWith(`/dashboard/bookings/${id}`)
})
it.each(pairs.filter(([from, to]) => !ALLOWED.has(`${from}>${to}`)))("rejects %s -> %s before backend access", async (from, to) => {
  expect(await updateBookingStatus(id, to, from)).toEqual({ success: false, error: "This status change is not allowed." })
  expect(db.from).not.toHaveBeenCalled()
  expect(db.auth.getUser).not.toHaveBeenCalled()
})
it("covers all 36 status pairs", () => expect(pairs).toHaveLength(36))
it("adds the stored-date condition only when completing", async () => {
  vi.useFakeTimers({ now: new Date("2026-11-21T12:00:00Z") })
  try {
    await updateBookingStatus(id, "completed", "confirmed")
    expect(query.lte).toHaveBeenCalledWith("date", "2026-11-21")
    query.lte.mockClear()
    await updateBookingStatus(id, "cancelled", "confirmed")
    expect(query.lte).not.toHaveBeenCalled()
  } finally { vi.useRealTimers() }
})
const zeroRowsThen = (current: unknown) => query.maybeSingle
  .mockResolvedValueOnce({ data: null, error: null })
  .mockResolvedValueOnce({ data: current, error: null })
it("reports a stale status as changed elsewhere, not as missing", async () => {
  zeroRowsThen({ id, status: "cancelled", date: "2026-01-01" })
  expect(await updateBookingStatus(id, "confirmed", "in_progress")).toEqual({
    success: false, error: "This booking was changed elsewhere. Reload and try again.",
  })
  expect(query.select).toHaveBeenCalledWith("id, status, date")
  expect(revalidatePath).not.toHaveBeenCalled()
})
it("reports a missing or out-of-workspace booking as not found, not as stale", async () => {
  zeroRowsThen(null)
  expect(await updateBookingStatus(id, "confirmed", "in_progress")).toEqual({ success: false, error: "Booking not found" })
  expect(query.eq).toHaveBeenCalledWith("workspace_id", "selected-workspace")
})
it("refuses completion before the booking date with its own message", async () => {
  vi.useFakeTimers({ now: new Date("2026-11-21T12:00:00Z") })
  try {
    zeroRowsThen({ id, status: "confirmed", date: "2026-11-22" })
    expect(await updateBookingStatus(id, "completed", "confirmed")).toEqual({
      success: false, error: "A booking can be marked as completed only on or after its date.",
    })
  } finally { vi.useRealTimers() }
})
it.each([
  ["BB002", "This status change is not allowed."],
  ["BB003", "A completed booking cannot be moved to a future date."],
  ["BB009", "This booking has an event and was cancelled, so it cannot be reopened. Create a new booking to rebook."],
  ["XX000", "Unable to update the booking status. Please try again."],
])("maps database rejection %s to fixed copy on status change", async (code, message) => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {})
  try {
    query.maybeSingle.mockResolvedValueOnce({ data: null, error: { code, message: "PRIVATE_DATABASE_DETAIL" } })
    expect(await updateBookingStatus(id, "confirmed", "in_progress")).toEqual({ success: false, error: message })
  } finally { log.mockRestore() }
})
it("revalidates the events pages when a booking is cancelled (its event follows)", async () => {
  query.maybeSingle.mockResolvedValueOnce({ data: { id }, error: null })
  expect(await updateBookingStatus(id, "cancelled", "confirmed")).toEqual({ success: true })
  expect(revalidatePath).toHaveBeenCalledWith("/dashboard/events", "layout")
})
it("fails closed when the conflict read itself fails", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {})
  try {
    query.maybeSingle.mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: null, error: { message: "PRIVATE_DATABASE_DETAIL" } })
    expect(await updateBookingStatus(id, "confirmed", "in_progress")).toEqual({
      success: false, error: "Unable to update the booking status. Please try again.",
    })
  } finally { log.mockRestore() }
})
it.each([
  ["create", () => createBooking(input), "single", "Unable to create booking. Please try again."],
  ["update", () => updateBooking(id, { notes: "x" }), "maybeSingle", "Unable to save booking. Please try again."],
  ["delete", () => deleteBooking(id), "maybeSingle", "Unable to delete booking. Please try again."],
] as const)("never returns the provider message from %s", async (_label, action, terminal, message) => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {})
  try {
    query[terminal].mockResolvedValueOnce({ data: null, error: { code: "42501", message: "PRIVATE_DATABASE_DETAIL" } })
    expect(await action()).toEqual({ success: false, error: message })
  } finally { log.mockRestore() }
})
it("never persists a status through updateBooking", async () => {
  const result = await updateBooking(id, { notes: "x", status: "confirmed" } as Parameters<typeof updateBooking>[1])
  expect(result).toEqual({ success: false, error: "Change the booking status with the status control" })
  expect(db.from).not.toHaveBeenCalled()
})
it.each([["2026-12-01", "2026-12-01"], [null, null]])("persists hold expiry %j through the update allowlist", async (value, stored) => {
  expect(await updateBooking(id, { hold_expires_on: value })).toEqual({ success: true })
  expect(query.update).toHaveBeenCalledWith({ hold_expires_on: stored, updated_at: expect.any(String) })
})
it("explains a hold expiry rejected because the booking is not on hold", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {})
  try {
    query.maybeSingle.mockResolvedValueOnce({ data: null, error: { code: "23514", message: "PRIVATE_DATABASE_DETAIL" } })
    expect(await updateBooking(id, { hold_expires_on: "2026-12-01" })).toEqual({
      success: false, error: "A hold expiry date can only be set while the booking is on hold.",
    })
    query.maybeSingle.mockResolvedValueOnce({ data: null, error: { code: "BB003", message: "PRIVATE_DATABASE_DETAIL" } })
    expect(await updateBooking(id, { date: "2031-01-01" })).toEqual({
      success: false, error: "A completed booking cannot be moved to a future date.",
    })
  } finally { log.mockRestore() }
})

// Migration 008: optional promoter from the directory (decision 2).
const promoter = "33333333-3333-4333-8333-333333333333"
it("creates a booking with the chosen promoter, and without the column when none is chosen", async () => {
  await createBooking({ ...input, promoterId: promoter })
  expect(query.insert).toHaveBeenLastCalledWith(expect.objectContaining({ promoter_id: promoter, workspace_id: "selected-workspace", status: "in_progress" }))
  await createBooking(input)
  expect("promoter_id" in (query.insert.mock.calls.at(-1)?.[0] as object)).toBe(false)
})
it.each(["", "not-a-uuid"])("rejects a malformed promoter %j on create before backend access", async (promoterId) => {
  expect(await createBooking({ ...input, promoterId })).toEqual({ success: false, error: "Choose a valid promoter" })
  expect(db.from).not.toHaveBeenCalled()
})
it.each([[promoter], [null]])("persists promoter_id %j through the validated update only", async (promoter_id) => {
  expect(await updateBooking(id, { promoter_id })).toEqual({ success: true })
  expect(query.update).toHaveBeenLastCalledWith({ promoter_id, updated_at: expect.any(String) })
  expect(query.eq).toHaveBeenCalledWith("workspace_id", "selected-workspace")
})
it("leaves the promoter out of the write when it is omitted, and rejects a malformed one", async () => {
  await updateBooking(id, { notes: "x" })
  expect("promoter_id" in (query.update.mock.calls.at(-1)?.[0] as object)).toBe(false)
  db.from.mockClear()
  expect(await updateBooking(id, { promoter_id: "nope" })).toEqual({ success: false, error: "Choose a valid promoter" })
  expect(db.from).not.toHaveBeenCalled()
})
it.each([
  ["create", () => createBooking({ ...input, promoterId: promoter }), "single"],
  ["update", () => updateBooking(id, { promoter_id: promoter }), "maybeSingle"],
] as const)("answers %s with fixed copy when the promoter was deleted or belongs to another workspace", async (_label, action, terminal) => {
  query[terminal].mockResolvedValueOnce({ data: null, error: { code: "23503", message: 'insert or update on table "bookings" violates foreign key constraint "bookings_promoter_id_fkey"' } })
  const log = vi.spyOn(console, "error").mockImplementation(() => {})
  try {
    expect(await action()).toEqual({ success: false, error: "The selected promoter no longer exists. Choose another promoter." })
  } finally { log.mockRestore() }
})
it("does not blame the promoter for another foreign-key failure", async () => {
  query.single.mockResolvedValueOnce({ data: null, error: { code: "23503", message: 'violates foreign key constraint "bookings_artist_id_fkey"' } })
  const log = vi.spyOn(console, "error").mockImplementation(() => {})
  try {
    expect(await createBooking({ ...input, promoterId: promoter })).toEqual({ success: false, error: "Unable to create booking. Please try again." })
  } finally { log.mockRestore() }
})
