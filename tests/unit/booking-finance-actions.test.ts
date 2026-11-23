import { beforeEach, expect, it, vi } from "vitest"

// One query builder per table. Awaiting a builder (or its maybeSingle/range) takes the next
// queued result of that table; an empty queue is a test error, never an implicit success.
type Result = { data?: unknown; error?: { code?: string; message?: string } | null; count?: number | null }
const mocks = vi.hoisted(() => ({
  tables: new Map<string, Record<string, ReturnType<typeof vi.fn>>>(),
  queues: new Map<string, unknown[]>(),
  from: vi.fn(), getUser: vi.fn(), workspace: vi.fn(), revalidatePath: vi.fn(),
}))
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => ({ from: mocks.from, auth: { getUser: mocks.getUser } })) }))
vi.mock("@/lib/actions/workspace", () => ({ getCurrentWorkspaceId: mocks.workspace }))
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }))
import { createBookingPayment, deleteBookingPayment, getBookingPayments, updateBookingPayment } from "@/lib/actions/booking-payments"
import { createBooking, deleteBooking, updateBooking } from "@/lib/actions/bookings"
import { updateArtistDefaultCommission } from "@/lib/actions/artists"

const BOOKING = "11111111-1111-4111-8111-111111111111"
const PAYMENT = "22222222-2222-4222-8222-222222222222"
const ARTIST = "33333333-3333-4333-8333-333333333333"
const WORKSPACE = "selected-workspace"
const payment = { kind: "deposit", amount_minor: 30000, currency: "EUR" } as const
const row = { id: PAYMENT, booking_id: BOOKING, kind: "deposit", amount_minor: 30000, currency: "EUR", due_on: null, paid_on: null, note: null }

const queue = (table: string, ...results: Result[]) => mocks.queues.set(table, [...(mocks.queues.get(table) ?? []), ...results])
const table = (name: string) => mocks.tables.get(name)!
function builder(name: string) {
  const next = () => {
    const pending = mocks.queues.get(name) ?? []
    if (pending.length === 0) throw new Error(`Unexpected query on ${name}`)
    return Promise.resolve(pending.shift())
  }
  const query: Record<string, ReturnType<typeof vi.fn>> = {}
  for (const method of ["select", "insert", "update", "delete", "eq", "order"]) query[method] = vi.fn(() => query)
  for (const method of ["maybeSingle", "single", "range"]) query[method] = vi.fn(next)
  Object.assign(query, { then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => next().then(resolve, reject) })
  return query
}
let logged: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  vi.clearAllMocks()
  mocks.tables.clear()
  mocks.queues.clear()
  for (const name of ["bookings", "booking_payments", "artists"]) mocks.tables.set(name, builder(name))
  mocks.from.mockImplementation((name: string) => table(name))
  mocks.getUser.mockResolvedValue({ data: { user: { id: "user-a" } }, error: null })
  mocks.workspace.mockResolvedValue(WORKSPACE)
  logged = vi.spyOn(console, "error").mockImplementation(() => {})
})
const untouched = () => { expect(mocks.from).not.toHaveBeenCalled(); expect(mocks.getUser).not.toHaveBeenCalled() }

// --- payments: read ---
it("reads the payments of one booking in the selected workspace with explicit fields and a stable order", async () => {
  queue("booking_payments", { data: [{ ...row, workspace_id: "leak", created_at: "x" }], error: null, count: 1 })
  expect(await getBookingPayments(BOOKING)).toEqual([{ ...row, workspace_id: "leak", created_at: "x" }])
  const query = table("booking_payments")
  expect(query.select).toHaveBeenCalledWith("id, booking_id, kind, amount_minor, currency, due_on, paid_on, note", { count: "exact" })
  expect(query.eq.mock.calls).toEqual([["workspace_id", WORKSPACE], ["booking_id", BOOKING]])
  expect(query.order.mock.calls.map(call => call[0])).toEqual(["due_on", "created_at", "id"])
})
it("rejects a failed or incomplete payments read with fixed copy instead of an empty list", async () => {
  queue("booking_payments", { data: null, error: { message: "relation booking_payments does not exist" }, count: null })
  await expect(getBookingPayments(BOOKING)).rejects.toThrow("Unable to load payments. Please try again.")
  queue("booking_payments", { data: [], error: null, count: 2 })
  await expect(getBookingPayments(BOOKING)).rejects.toThrow("Unable to load payments. Please try again.")
})
it("does not read payments for a malformed booking id or without a session", async () => {
  await expect(getBookingPayments("nope")).rejects.toThrow("Invalid booking ID")
  untouched()
  mocks.getUser.mockResolvedValueOnce({ data: { user: null }, error: null })
  await expect(getBookingPayments(BOOKING)).rejects.toThrow("Not authenticated")
  expect(mocks.from).not.toHaveBeenCalled()
})

// --- payments: create ---
it("records a payment in the fee currency, inside the selected workspace", async () => {
  queue("bookings", { data: { id: BOOKING, fee_currency: "EUR" }, error: null })
  queue("booking_payments", { data: { id: PAYMENT }, error: null })
  expect(await createBookingPayment(BOOKING, { ...payment, due_on: "2026-12-01", note: " first half " })).toEqual({ success: true })
  expect(table("bookings").eq.mock.calls).toEqual([["id", BOOKING], ["workspace_id", WORKSPACE]])
  expect(table("booking_payments").insert).toHaveBeenCalledExactlyOnceWith({
    kind: "deposit", amount_minor: 30000, currency: "EUR", due_on: "2026-12-01", note: "first half",
    workspace_id: WORKSPACE, booking_id: BOOKING,
  })
  expect(mocks.revalidatePath).toHaveBeenCalledWith(`/dashboard/bookings/${BOOKING}`)
})
it.each([
  [{ fee_currency: "USD" }, "A payment must be in the booking fee currency."],
  [{ fee_currency: "JPY" }, "A payment must be in the booking fee currency."],
  [{ fee_currency: null }, "Set and save a booking fee before recording payments."],
])("refuses a EUR payment on a booking with %j before writing", async (booking, error) => {
  queue("bookings", { data: { id: BOOKING, ...booking }, error: null })
  expect(await createBookingPayment(BOOKING, payment)).toEqual({ success: false, error })
  expect(table("booking_payments").insert).not.toHaveBeenCalled()
  expect(mocks.revalidatePath).not.toHaveBeenCalled()
})
it("reports a missing or out-of-workspace booking", async () => {
  queue("bookings", { data: null, error: null })
  expect(await createBookingPayment(BOOKING, payment)).toEqual({ success: false, error: "Booking not found" })
  expect(table("booking_payments").insert).not.toHaveBeenCalled()
})
it.each([
  ["BB004", "A payment must be in the booking fee currency."],
  ["23503", "Booking not found"],
  ["42501", "Unable to save the payment. Please try again."],
  ["23514", "Unable to save the payment. Please try again."],
])("maps database error %s on insert to fixed copy and never returns the provider message", async (code, error) => {
  queue("bookings", { data: { id: BOOKING, fee_currency: "EUR" }, error: null })
  queue("booking_payments", { data: null, error: { code, message: "secret provider detail" } })
  expect(await createBookingPayment(BOOKING, payment)).toEqual({ success: false, error })
  expect(logged).toHaveBeenCalled()
  expect(mocks.revalidatePath).not.toHaveBeenCalled()
})
it("does not report success when the insert returns no row", async () => {
  queue("bookings", { data: { id: BOOKING, fee_currency: "EUR" }, error: null })
  queue("booking_payments", { data: null, error: null })
  expect(await createBookingPayment(BOOKING, payment)).toEqual({ success: false, error: "Unable to save the payment. Please try again." })
})
it.each([
  { amount_minor: 0 }, { amount_minor: -5 }, { amount_minor: 10.5 }, { kind: "refund" }, { currency: "CHF" },
  { due_on: "2026-13-01" }, { paid_on: "soon" }, { note: "n".repeat(501) }, { workspace_id: "other" }, { booking_id: "other" },
])("rejects invalid payment input %j before authentication or backend access", async (patch) => {
  const result = await createBookingPayment(BOOKING, { ...payment, ...patch } as Parameters<typeof createBookingPayment>[1])
  expect(result.success).toBe(false)
  expect(result.error).toBeTruthy()
  untouched()
})
it("rejects a malformed booking id and a signed-out caller", async () => {
  expect(await createBookingPayment("nope", payment)).toEqual({ success: false, error: "Invalid booking ID" })
  untouched()
  mocks.getUser.mockResolvedValueOnce({ data: { user: null } })
  expect(await createBookingPayment(BOOKING, payment)).toEqual({ success: false, error: "Not authenticated" })
  expect(mocks.from).not.toHaveBeenCalled()
})

// --- payments: update / delete ---
it("updates only allowlisted payment fields, scoped to the workspace, with an affected-row witness", async () => {
  queue("booking_payments", { data: { id: PAYMENT, booking_id: BOOKING }, error: null })
  expect(await updateBookingPayment(PAYMENT, { paid_on: "2026-11-23", note: "" })).toEqual({ success: true })
  const query = table("booking_payments")
  expect(query.update).toHaveBeenCalledExactlyOnceWith({ paid_on: "2026-11-23", note: null })
  expect(query.eq.mock.calls).toEqual([["id", PAYMENT], ["workspace_id", WORKSPACE]])
  expect(mocks.revalidatePath).toHaveBeenCalledWith(`/dashboard/bookings/${BOOKING}`)
})
it("clears the paid date with an explicit null", async () => {
  queue("booking_payments", { data: { id: PAYMENT, booking_id: BOOKING }, error: null })
  await updateBookingPayment(PAYMENT, { paid_on: null })
  expect(table("booking_payments").update).toHaveBeenCalledExactlyOnceWith({ paid_on: null })
})
it.each([
  ["update", () => updateBookingPayment(PAYMENT, { amount_minor: 100 })],
  ["delete", () => deleteBookingPayment(PAYMENT)],
])("reports a missing or out-of-workspace payment on %s instead of false success", async (_label, action) => {
  queue("booking_payments", { data: null, error: null })
  expect(await action()).toEqual({ success: false, error: "Payment not found" })
  expect(mocks.revalidatePath).not.toHaveBeenCalled()
})
it.each([
  ["update", () => updateBookingPayment(PAYMENT, { amount_minor: 100 }), "Unable to save the payment. Please try again."],
  ["delete", () => deleteBookingPayment(PAYMENT), "Unable to delete the payment. Please try again."],
])("returns fixed copy when %s fails in the database", async (_label, action, error) => {
  queue("booking_payments", { data: null, error: { code: "XX000", message: "secret provider detail" } })
  expect(await action()).toEqual({ success: false, error })
})
it.each([
  [{}], [{ currency: "USD" }], [{ booking_id: BOOKING }], [{ workspace_id: "other" }], [{ amount_minor: 0 }], [{ paid_on: "2026-02-30" }],
])("rejects the payment update %j before backend access", async (patch) => {
  expect((await updateBookingPayment(PAYMENT, patch as Parameters<typeof updateBookingPayment>[1])).success).toBe(false)
  untouched()
})
it("deletes one payment inside the workspace and rejects malformed ids", async () => {
  queue("booking_payments", { data: { id: PAYMENT, booking_id: BOOKING }, error: null })
  expect(await deleteBookingPayment(PAYMENT)).toEqual({ success: true })
  expect(table("booking_payments").eq.mock.calls).toEqual([["id", PAYMENT], ["workspace_id", WORKSPACE]])
  expect(await deleteBookingPayment("nope")).toEqual({ success: false, error: "Invalid payment ID" })
  expect(await updateBookingPayment("nope", { paid_on: null })).toEqual({ success: false, error: "Invalid payment ID" })
})

// --- bookings: fee currency lock, delete, commission, prefill ---
const LOCKED = "The fee currency cannot be changed while payments are recorded for this booking. The fee amount can still be changed."
it("blocks a fee currency change while payments exist, before writing (decision 6)", async () => {
  queue("bookings", { data: { id: BOOKING, fee_currency: "EUR" }, error: null })
  queue("booking_payments", { count: 2, error: null })
  expect(await updateBooking(BOOKING, { fee_amount_minor: 100000, fee_currency: "USD" })).toEqual({ success: false, error: LOCKED })
  expect(table("bookings").update).not.toHaveBeenCalled()
  expect(table("booking_payments").select).toHaveBeenCalledWith("id", { count: "exact", head: true })
  expect(table("booking_payments").eq.mock.calls).toEqual([["booking_id", BOOKING], ["workspace_id", WORKSPACE]])
})
it("blocks clearing the fee while payments exist", async () => {
  queue("bookings", { data: { id: BOOKING, fee_currency: "EUR" }, error: null })
  queue("booking_payments", { count: 1, error: null })
  expect(await updateBooking(BOOKING, { fee_amount_minor: null, fee_currency: null })).toEqual({ success: false, error: LOCKED })
  expect(table("bookings").update).not.toHaveBeenCalled()
})
it("lets the fee amount change in the same currency without counting payments", async () => {
  queue("bookings", { data: { id: BOOKING, fee_currency: "EUR" }, error: null }, { data: { id: BOOKING }, error: null })
  expect(await updateBooking(BOOKING, { fee_amount_minor: 120000, fee_currency: "EUR" })).toEqual({ success: true })
  expect(mocks.from).not.toHaveBeenCalledWith("booking_payments")
  expect(table("bookings").update).toHaveBeenCalledExactlyOnceWith({ fee_amount_minor: 120000, fee_currency: "EUR", updated_at: expect.any(String) })
})
it("lets the currency change when no payment exists", async () => {
  queue("bookings", { data: { id: BOOKING, fee_currency: "EUR" }, error: null }, { data: { id: BOOKING }, error: null })
  queue("booking_payments", { count: 0, error: null })
  expect(await updateBooking(BOOKING, { fee_amount_minor: 100000, fee_currency: "JPY" })).toEqual({ success: true })
})
it("fails closed when the payment count is unavailable", async () => {
  queue("bookings", { data: { id: BOOKING, fee_currency: "EUR" }, error: null })
  queue("booking_payments", { count: null, error: { message: "secret" } })
  expect(await updateBooking(BOOKING, { fee_amount_minor: 1, fee_currency: "USD" })).toEqual({ success: false, error: "Unable to save booking. Please try again." })
  expect(table("bookings").update).not.toHaveBeenCalled()
})
it("does not pre-read anything for a patch without the fee", async () => {
  queue("bookings", { data: { id: BOOKING }, error: null })
  expect(await updateBooking(BOOKING, { notes: "x", tax_note: " VAT note " })).toEqual({ success: true })
  expect(table("bookings").update).toHaveBeenCalledExactlyOnceWith({ notes: "x", tax_note: "VAT note", updated_at: expect.any(String) })
  expect(table("bookings").select.mock.calls).toEqual([["id"]])
})
it.each([
  [{ code: "BB005", message: "secret" }, LOCKED],
  [{ code: "23514", message: 'violates check constraint "bookings_commission_within_fee_check"' }, "A fixed commission included in the fee cannot be greater than the fee"],
  [{ code: "23514", message: 'violates check constraint "bookings_tax_note_check"' }, "Unable to save booking. Please try again."],
])("maps the database backstop %j to fixed copy", async (error, copy) => {
  queue("bookings", { data: null, error })
  expect(await updateBooking(BOOKING, { commission_type: "fixed", commission_value: 500, commission_mode: "included" })).toEqual({ success: false, error: copy })
})
it("persists a validated commission triple and clears it with nulls", async () => {
  queue("bookings", { data: { id: BOOKING }, error: null }, { data: { id: BOOKING }, error: null })
  await updateBooking(BOOKING, { commission_type: "percent", commission_value: 1500, commission_mode: "on_top" })
  await updateBooking(BOOKING, { commission_type: null, commission_value: null, commission_mode: null })
  expect(table("bookings").update.mock.calls.map(call => call[0])).toEqual([
    { commission_type: "percent", commission_value: 1500, commission_mode: "on_top", updated_at: expect.any(String) },
    { commission_type: null, commission_value: null, commission_mode: null, updated_at: expect.any(String) },
  ])
})
it.each([
  { commission_type: "percent", commission_value: 10001, commission_mode: "on_top" },
  { commission_type: "percent", commission_value: 1500 },
  { commission_value: 1500 },
  { tax_note: "t".repeat(2001) },
])("rejects the invalid finance patch %j before backend access", async (patch) => {
  expect((await updateBooking(BOOKING, patch)).success).toBe(false)
  untouched()
})
it("returns the fixed has-payments copy when the foreign key blocks a booking delete (decision 8)", async () => {
  queue("bookings", { data: null, error: { code: "23503", message: 'violates foreign key constraint "booking_payments_booking_fkey"' } })
  expect(await deleteBooking(BOOKING)).toEqual({
    success: false,
    error: "This booking has recorded payments and cannot be deleted. Remove its payments first, or cancel the booking instead.",
  })
  queue("bookings", { data: null, error: { code: "XX000", message: "secret" } })
  expect(await deleteBooking(BOOKING)).toEqual({ success: false, error: "Unable to delete booking. Please try again." })
})

const create = { artistId: ARTIST, date: "2026-12-12", startTime: "21:00", durationMinutes: 90 }
const stored = (type: string | null, value: number | null, mode: string | null, currency: string | null = null) =>
  ({ default_commission_type: type, default_commission_value: value, default_commission_mode: mode, default_commission_currency: currency })
it.each([
  [stored("percent", 1250, "on_top"), { commission_type: "percent", commission_value: 1250, commission_mode: "on_top" }],
  [stored("percent", 1250, "included"), { commission_type: "percent", commission_value: 1250, commission_mode: "included" }],
  // A booking is created without a fee: a fixed default (own currency) is never copied here.
  [stored("fixed", 25000, "on_top", "EUR"), {}],
  [stored("fixed", 30000, "included", "JPY"), {}],
  [stored(null, null, null), {}],
  [{}, {}],
  [stored("percent", 1250, null), {}],
  [stored("percent", 10001, "on_top"), {}],
  [stored("percent", 1250, "on_top", "EUR"), {}],
  [stored("fixed", 25000, "on_top"), {}],
  [stored("tiered", 5, "on_top"), {}],
])("prefills a new booking from the artist default %j", async (artistDefault, commission) => {
  queue("artists", { data: { id: ARTIST, ...artistDefault }, error: null })
  queue("bookings", { data: { id: BOOKING }, error: null })
  expect((await createBooking(create)).success).toBe(true)
  expect(table("artists").select).toHaveBeenCalledWith("id, default_commission_type, default_commission_value, default_commission_mode, default_commission_currency")
  expect(table("artists").eq.mock.calls).toEqual([["id", ARTIST], ["workspace_id", WORKSPACE]])
  expect(table("bookings").insert).toHaveBeenCalledExactlyOnceWith({
    workspace_id: WORKSPACE, artist_id: ARTIST, date: "2026-12-12", start_time: "21:00", duration_minutes: 90,
    notes: null, status: "in_progress", ...commission,
  })
})
it("does not create a booking for an artist outside the workspace or when the default cannot be read", async () => {
  queue("artists", { data: null, error: null })
  expect(await createBooking(create)).toEqual({ success: false, error: "Artist not found" })
  queue("artists", { data: null, error: { message: "secret" } })
  expect(await createBooking(create)).toEqual({ success: false, error: "Unable to create booking. Please try again." })
  expect(table("bookings").insert).not.toHaveBeenCalled()
})

// --- artist default commission ---
it.each([
  [{ type: "percent", value: 1250, mode: "included" }, stored("percent", 1250, "included")],
  [{ type: "percent", value: 1250, mode: "on_top", currency: null }, stored("percent", 1250, "on_top")],
  [{ type: "fixed", value: 25000, mode: "on_top", currency: "EUR" }, stored("fixed", 25000, "on_top", "EUR")],
  [{ type: "fixed", value: 30000, mode: "included", currency: "JPY" }, stored("fixed", 30000, "included", "JPY")],
  [null, stored(null, null, null)],
] as const)("saves the artist default commission %j inside the workspace", async (input, row) => {
  queue("artists", { data: { id: ARTIST }, error: null })
  expect(await updateArtistDefaultCommission(ARTIST, input)).toEqual({ success: true })
  expect(table("artists").update).toHaveBeenCalledExactlyOnceWith(row)
  expect(table("artists").eq.mock.calls).toEqual([["id", ARTIST], ["workspace_id", WORKSPACE]])
  expect(mocks.revalidatePath).toHaveBeenCalledWith(`/dashboard/artists/${ARTIST}`)
})

it("artist default commission: witness, fixed copy, validation before backend access", async () => {
  queue("artists", { data: null, error: null })
  expect(await updateArtistDefaultCommission(ARTIST, null)).toEqual({ success: false, error: "Artist not found" })
  queue("artists", { data: null, error: { message: "secret provider detail" } })
  expect(await updateArtistDefaultCommission(ARTIST, null)).toEqual({ success: false, error: "Unable to save the default commission. Please try again." })
  vi.clearAllMocks()
  for (const input of [
    { type: "percent", value: 10001, mode: "on_top" }, { type: "tiered", value: 1, mode: "on_top" },
    { type: "fixed", value: -1, mode: "on_top", currency: "EUR" }, { type: "fixed", value: 1.5, mode: "on_top", currency: "EUR" },
    { type: "fixed", value: 25000, mode: "on_top" }, { type: "fixed", value: 25000, mode: "on_top", currency: "CHF" },
    { type: "percent", value: 1250, mode: "on_top", currency: "EUR" }, { type: "percent", value: 1250 }, { type: "percent", value: 1250, mode: "split" },
  ]) {
    expect((await updateArtistDefaultCommission(ARTIST, input as Parameters<typeof updateArtistDefaultCommission>[1])).success).toBe(false)
  }
  expect((await updateArtistDefaultCommission("nope", null)).error).toBe("Invalid artist ID")
  expect(mocks.from).not.toHaveBeenCalled()
})
