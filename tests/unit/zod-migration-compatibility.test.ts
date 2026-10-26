import { expect, it } from "vitest"
import { createArtistSchema, updateArtistSchema } from "@/lib/artist-validation"
import { bookingIdSchema, createBookingSchema, updateBookingSchema } from "@/lib/booking-validation"
import { eventDateParts } from "@/lib/event-date-display"

// Characterization of incumbent application contracts, not new acceptance rules.
const legacyIds = [
  "11111111-1111-4111-8111-111111111111",
  "00000000-0000-0000-0000-000000000000",
  "ffffffff-ffff-ffff-ffff-ffffffffffff",
  "12345678-1234-1234-1234-123456789abc",
  "ABCDEF12-1234-1234-1234-123456789ABC",
]

it.each(legacyIds)("preserves literal UUID-shaped identifier %s", id => {
  expect(bookingIdSchema.parse(id)).toBe(id)
  expect(createBookingSchema.parse({
    artistId: id, date: "2028-02-29", startTime: "09:30", durationMinutes: 0,
  }).artistId).toBe(id)
})

it.each(["", "bad", "11111111-1111-4111-8111-111111111111 ", " 11111111-1111-4111-8111-111111111111"])(
  "does not repair malformed identifier %j", id => {
    expect(bookingIdSchema.safeParse(id).success).toBe(false)
  },
)

it.each(["a+tag@sub.example.test", "o'connor@example.com", "USER@example.test"])(
  "preserves accepted email %s", email => {
    expect(createArtistSchema.parse({ stage_name: "Stage", email }).email).toBe(email)
    expect(updateBookingSchema.parse({ contact_email_main: email }).contact_email_main).toBe(email)
  },
)

it("preserves omission, nulls, stripping and fractional artist fees", () => {
  expect(updateArtistSchema.parse({ workspace_id: "ignored" })).toEqual({})
  expect(updateArtistSchema.parse({ fee: 0, currency: null, genres: [], name: "" })).toEqual({
    fee: 0, currency: null, genres: [], name: "",
  })
  expect(createArtistSchema.parse({ stage_name: " Stage ", fee: 12.5 }).fee).toBe(12.5)
  expect(updateBookingSchema.parse({})).toEqual({})
  expect(updateBookingSchema.parse({ contact_email_main: " " })).toEqual({ contact_email_main: null })
  expect(updateBookingSchema.safeParse({ fee_amount_minor: 0 }).success).toBe(false)
  expect(updateBookingSchema.parse({ fee_amount_minor: 0, fee_currency: "EUR" })).toEqual({
    fee_amount_minor: 0, fee_currency: "EUR",
  })
})

it.each([
  ["2028-02-29", true], ["2027-02-29", false], ["2026-02-30", false],
  ["2026-01-01T00:00:00Z", false], [" 2026-01-01", false],
] as const)("preserves date-only validity for %s", (date, valid) => {
  expect(createBookingSchema.safeParse({
    artistId: legacyIds[0], date, startTime: "09:30", durationMinutes: 0,
  }).success).toBe(valid)
  expect(eventDateParts(date).month === "?").toBe(!valid)
})
