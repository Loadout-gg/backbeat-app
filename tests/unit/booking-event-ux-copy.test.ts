import { expect, it } from "vitest"
import { BOOKING_EVENT_COPY, bookingEventErrorCopy, cancelBookingConfirmCopy } from "@/lib/booking-event"

it("maps every 008 SQLSTATE to its fixed copy and nothing else", () => {
  expect(bookingEventErrorCopy({ code: "BB008" })).toBe(BOOKING_EVENT_COPY.notConvertible)
  expect(bookingEventErrorCopy({ code: "BB009" })).toBe(BOOKING_EVENT_COPY.convertedStaysCancelled)
  expect(bookingEventErrorCopy({ code: "BB010" })).toBe(BOOKING_EVENT_COPY.eventStaysCancelled)
  expect(bookingEventErrorCopy({ code: "BB011" })).toBe(BOOKING_EVENT_COPY.bookingHasEvent)
  for (const code of ["BB001", "BB007", "23503", "42501", "", null, undefined]) expect(bookingEventErrorCopy({ code })).toBeNull()
  expect(bookingEventErrorCopy(null)).toBeNull()
})

it("cancel confirmation: irreversible with an event, reversible without, hedged when unknown; payments always kept", () => {
  const withEvent = cancelBookingConfirmCopy(true)
  expect(withEvent).toMatch(/^This cannot be undone\./)
  expect(withEvent).toContain("cancelled with it")
  expect(withEvent).toContain("create a new booking")
  const without = cancelBookingConfirmCopy(false)
  expect(without).not.toContain("cannot be undone")
  expect(without).toContain("reopened as in progress later")
  expect(cancelBookingConfirmCopy("unknown")).toContain("could not be checked")
  for (const copy of [withEvent, without, cancelBookingConfirmCopy("unknown")]) {
    expect(copy).toContain("Recorded payments are kept; void them separately if needed.")
  }
})
