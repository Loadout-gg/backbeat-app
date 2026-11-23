import { beforeEach, expect, it, vi } from "vitest"

type Result = { data: unknown; error: { code?: string; message?: string } | null }
type Call = { table: string; steps: [string, ...unknown[]][] }
const mocks = vi.hoisted(() => ({
  results: [] as Result[], calls: [] as Call[],
  createClient: vi.fn(), workspace: vi.fn(), revalidatePath: vi.fn(),
}))
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }))
vi.mock("@/lib/actions/workspace", () => ({ getCurrentWorkspaceId: mocks.workspace }))
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }))
import { createEventFromBooking, getBookingEventLink } from "@/lib/actions/booking-events"
import { BOOKING_EVENT_COPY, bookingEventTitle, canConvertBookingToEvent, isBookingPromoterViolation, promoterOptionLabel } from "@/lib/booking-event"
import { BOOKING_STATUSES } from "@/lib/booking-status"

const WORKSPACE = "selected-workspace"
const BOOKING = "11111111-1111-4111-8111-111111111111"
const ARTIST = "22222222-2222-4222-8222-222222222222"
const PROMOTER = "33333333-3333-4333-8333-333333333333"
const EVENT = "44444444-4444-4444-8444-444444444444"
const OTHER_EVENT = "55555555-5555-4555-8555-555555555555"
const booking = {
  id: BOOKING, status: "confirmed", date: "2030-03-01", start_time: "21:30:00", venue_name: " Club Synthetic ",
  artist_id: ARTIST, promoter_id: PROMOTER, fee_amount_minor: 150000, fee_currency: "EUR",
  artist: { stage_name: "DJ Alice", name: "Alice Rossi" },
}
const created = { id: EVENT, workspace_id: WORKSPACE, booking_id: BOOKING }
/** Each awaited query consumes the next queued result, in call order. */
const queue = (...results: Result[]) => { mocks.results.push(...results) }
const ok = (data: unknown): Result => ({ data, error: null })
const fail = (code: string): Result => ({ data: null, error: { code, message: "private database detail" } })
const step = (call: Call, name: string) => call.steps.filter(([method]) => method === name).map(([, ...args]) => args)

beforeEach(() => {
  vi.clearAllMocks()
  mocks.results.length = 0
  mocks.calls.length = 0
  mocks.workspace.mockResolvedValue(WORKSPACE)
  mocks.createClient.mockResolvedValue({
    from: (table: string) => {
      const call: Call = { table, steps: [] }
      mocks.calls.push(call)
      const builder: Record<string, unknown> = {}
      for (const method of ["select", "insert", "update", "delete", "eq"]) {
        builder[method] = (...args: unknown[]) => { call.steps.push([method, ...args]); return builder }
      }
      builder.maybeSingle = async () => {
        call.steps.push(["maybeSingle"])
        const next = mocks.results.shift()
        if (!next) throw new Error(`unexpected query on ${table}`)
        return next
      }
      return builder
    },
  })
  vi.spyOn(console, "error").mockImplementation(() => {})
})

it("creates one confirmed event from the stored booking with a single insert and never writes the booking", async () => {
  queue(ok(booking), ok(null), ok(created))
  expect(await createEventFromBooking(BOOKING)).toEqual({ success: true, eventId: EVENT })

  const [read, existing, insert] = mocks.calls
  expect(mocks.calls.map(call => call.table)).toEqual(["bookings", "events", "events"])
  expect(step(read, "eq")).toEqual([["workspace_id", WORKSPACE], ["id", BOOKING]])
  expect(step(existing, "eq")).toEqual([["workspace_id", WORKSPACE], ["booking_id", BOOKING]])
  expect(step(insert, "insert")).toEqual([[{
    workspace_id: WORKSPACE, booking_id: BOOKING, title: "DJ Alice @ Club Synthetic", date: "2030-03-01",
    location: "Club Synthetic", status: "confirmed", artist_id: ARTIST, promoter_id: PROMOTER,
    start_time: "21:30:00", fee_amount_minor: 150000, fee_currency: "EUR",
  }]])
  // Conversion never changes the booking: no update or delete on any table.
  for (const call of mocks.calls) expect(call.steps.some(([method]) => method === "update" || method === "delete")).toBe(false)
  expect(mocks.revalidatePath.mock.calls.map(call => call[0])).toEqual([
    "/dashboard/events", `/dashboard/events/${EVENT}`, `/dashboard/bookings/${BOOKING}`, "/dashboard", "/dashboard/artists",
  ])
})

it("reads with explicit projections only: no wildcard and no public_token", async () => {
  queue(ok(booking), ok(null), ok(created))
  await createEventFromBooking(BOOKING)
  const selections = mocks.calls.flatMap(call => step(call, "select").map(args => String(args[0])))
  expect(selections).toEqual([
    "id,status,date,start_time,venue_name,artist_id,promoter_id,fee_amount_minor,fee_currency,artist:artists(stage_name,name)",
    "id,title",
    "id,workspace_id,booking_id",
  ])
  for (const selection of selections) expect(selection).not.toMatch(/\*|public_token/)
})

it.each([
  ["no promoter, no fee, no venue", { promoter_id: null, fee_amount_minor: null, fee_currency: null, venue_name: null },
    { promoter_id: null, fee_amount_minor: null, fee_currency: null, location: null, title: "DJ Alice" }],
  ["blank venue and artist without stage name", { venue_name: "   ", artist: { stage_name: null, name: "Alice Rossi" } },
    { location: null, title: "Alice Rossi" }],
  ["blank stage name falls back to the name", { artist: { stage_name: "  ", name: "Alice Rossi" } }, { title: "Alice Rossi @ Club Synthetic" }],
  ["zero fee is a real fee", { fee_amount_minor: 0, fee_currency: "JPY" }, { fee_amount_minor: 0, fee_currency: "JPY" }],
  ["completed booking", { status: "completed" }, { status: "confirmed" }],
] as const)("copies the booking snapshot: %s", async (_label, overrides, expected) => {
  queue(ok({ ...booking, ...overrides }), ok(null), ok(created))
  expect(await createEventFromBooking(BOOKING)).toEqual({ success: true, eventId: EVENT })
  expect(step(mocks.calls[2], "insert")[0][0]).toMatchObject(expected)
})

it.each(BOOKING_STATUSES.filter(status => status !== "confirmed" && status !== "completed"))(
  "refuses a %s booking with fixed copy and inserts nothing", async (status) => {
    queue(ok({ ...booking, status }))
    expect(await createEventFromBooking(BOOKING)).toEqual({ success: false, error: "An event can be created only from a confirmed or completed booking." })
    expect(mocks.calls.map(call => call.table)).toEqual(["bookings"])
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })

it("fails cleanly on a retry: fixed copy, the existing event id, no insert", async () => {
  queue(ok(booking), ok({ id: OTHER_EVENT, title: "DJ Alice @ Club Synthetic" }))
  expect(await createEventFromBooking(BOOKING)).toEqual({
    success: false, error: "An event already exists for this booking.", existingEventId: OTHER_EVENT,
  })
  expect(mocks.calls).toHaveLength(2)
  expect(mocks.calls.some(call => step(call, "insert").length > 0)).toBe(false)
  expect(mocks.revalidatePath).not.toHaveBeenCalled()
})

it("resolves a lost race (unique violation) to the existing event without the provider message", async () => {
  queue(ok(booking), ok(null), fail("23505"), ok({ id: OTHER_EVENT, title: "x" }))
  const result = await createEventFromBooking(BOOKING)
  expect(result).toEqual({ success: false, error: "An event already exists for this booking.", existingEventId: OTHER_EVENT })
  expect(JSON.stringify(result)).not.toContain("private database detail")
  expect(step(mocks.calls[3], "eq")).toEqual([["workspace_id", WORKSPACE], ["booking_id", BOOKING]])
})

it("still answers with fixed copy when the winner of the race cannot be read", async () => {
  queue(ok(booking), ok(null), fail("23505"), fail("XX000"))
  expect(await createEventFromBooking(BOOKING)).toEqual({ success: false, error: "An event already exists for this booking." })
})

it("reports a booking, artist or promoter deleted meanwhile (foreign key) with fixed copy", async () => {
  queue(ok(booking), ok(null), fail("23503"))
  expect(await createEventFromBooking(BOOKING)).toEqual({ success: false, error: BOOKING_EVENT_COPY.changed })
})

it("maps the database status gate (BB006) to the same fixed copy as the application gate", async () => {
  // The booking left confirmed/completed between the read and the insert.
  queue(ok(booking), ok(null), fail("BB006"))
  const result = await createEventFromBooking(BOOKING)
  expect(result).toEqual({ success: false, error: "An event can be created only from a confirmed or completed booking." })
  expect(JSON.stringify(result)).not.toContain("private database detail")
  expect(mocks.calls).toHaveLength(3)
  expect(mocks.revalidatePath).not.toHaveBeenCalled()
})

it.each([
  ["booking read", [fail("XX000")]],
  ["existing-event read", [ok(booking), fail("XX000")]],
  ["insert", [ok(booking), ok(null), fail("XX000")]],
  ["insert refused by the status CHECK", [ok(booking), ok(null), fail("23514")]],
] as const)("hides the provider message when the %s fails", async (_label, results) => {
  queue(...results)
  const result = await createEventFromBooking(BOOKING)
  expect(result).toEqual({ success: false, error: "Unable to create the event. Please try again." })
  expect(mocks.revalidatePath).not.toHaveBeenCalled()
})

it("answers not found for a booking outside the selected workspace or a malformed id", async () => {
  queue(ok(null))
  expect(await createEventFromBooking(BOOKING)).toEqual({ success: false, error: "Booking not found" })
  expect(mocks.calls).toHaveLength(1)
  mocks.createClient.mockClear()
  expect(await createEventFromBooking("not-a-uuid")).toEqual({ success: false, error: "Booking not found" })
  expect(mocks.createClient).not.toHaveBeenCalled()
})

it.each([
  [null], [{}], [{ id: "not-a-uuid", workspace_id: WORKSPACE, booking_id: BOOKING }],
  [{ id: EVENT, workspace_id: "other-workspace", booking_id: BOOKING }],
  [{ id: EVENT, workspace_id: WORKSPACE, booking_id: OTHER_EVENT }],
])("does not report success without the created row as witness: %j", async (row) => {
  queue(ok(booking), ok(null), ok(row))
  expect(await createEventFromBooking(BOOKING)).toEqual({ success: false, error: BOOKING_EVENT_COPY.unconfirmed })
  expect(mocks.revalidatePath).not.toHaveBeenCalled()
})

it("does not trust a booking row with another id", async () => {
  queue(ok({ ...booking, id: OTHER_EVENT }))
  expect(await createEventFromBooking(BOOKING)).toEqual({ success: false, error: "Booking not found" })
})

it("reads the linked event of a booking inside the selected workspace, id and title only", async () => {
  queue(ok({ id: EVENT, title: "DJ Alice @ Club Synthetic", public_token: "secret", workspace_id: "x" }))
  expect(await getBookingEventLink(BOOKING)).toEqual({ id: EVENT, title: "DJ Alice @ Club Synthetic" })
  expect(mocks.calls[0].table).toBe("events")
  expect(step(mocks.calls[0], "select")).toEqual([["id,title"]])
  expect(step(mocks.calls[0], "eq")).toEqual([["workspace_id", WORKSPACE], ["booking_id", BOOKING]])
})

it("returns null when the booking has no event or the id is malformed, and throws fixed copy when the read fails", async () => {
  queue(ok(null))
  expect(await getBookingEventLink(BOOKING)).toBeNull()
  expect(await getBookingEventLink("not-a-uuid")).toBeNull()
  queue(fail("XX000"))
  await expect(getBookingEventLink(BOOKING)).rejects.toThrow("Unable to load the linked event.")
})

it("pure rules: gate, title, promoter label and promoter foreign-key detection", () => {
  expect(BOOKING_STATUSES.filter(canConvertBookingToEvent)).toEqual(["confirmed", "completed"])
  expect(canConvertBookingToEvent("anything")).toBe(false)
  expect(bookingEventTitle({ stage_name: "DJ Moon", name: "Luna" }, "Blue Room")).toBe("DJ Moon @ Blue Room")
  expect(bookingEventTitle({ stage_name: null, name: "Luna" }, "Blue Room")).toBe("Luna @ Blue Room")
  expect(bookingEventTitle({ stage_name: "DJ Moon", name: "Luna" }, null)).toBe("DJ Moon")
  expect(bookingEventTitle(null, "Blue Room")).toBe("Unknown artist @ Blue Room")
  expect(promoterOptionLabel({ name: "Marta Rossi", company_name: "Nightwave Srl" })).toBe("Marta Rossi (Nightwave Srl)")
  expect(promoterOptionLabel({ name: "Marta Rossi", company_name: null })).toBe("Marta Rossi")
  expect(isBookingPromoterViolation({ code: "23503", message: 'violates foreign key constraint "bookings_promoter_id_fkey"' })).toBe(true)
  expect(isBookingPromoterViolation({ code: "23503", message: "x", details: 'Key is not present; constraint "bookings_promoter_id_fkey"' })).toBe(true)
  expect(isBookingPromoterViolation({ code: "23503", message: 'violates foreign key constraint "bookings_artist_id_fkey"' })).toBe(false)
  expect(isBookingPromoterViolation({ code: "23514", message: "bookings_promoter_id_fkey" })).toBe(false)
  expect(isBookingPromoterViolation(null)).toBe(false)
})
