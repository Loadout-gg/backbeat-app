import { expect, it } from "vitest"
import {
  BOOKING_STATUSES, BOOKING_TRANSITIONS, allowedBookingTransitions, bookingTransitionBlock, canTransitionBooking,
} from "@/lib/booking-status"
import { BOOKING_STATUS_LABELS, BOOKING_TRANSITION_LABELS, holdRank, holdRankLabel, isHoldExpired } from "@/lib/booking-display"
import { bookingStatusSchema } from "@/lib/booking-validation"

const GRAPH: Record<string, string[]> = {
  in_progress: ["hold", "option", "confirmed", "cancelled"],
  hold: ["option", "confirmed", "cancelled", "in_progress"],
  option: ["confirmed", "cancelled", "hold"],
  confirmed: ["cancelled", "completed"],
  cancelled: ["in_progress"],
  completed: [],
}
it("keeps the six statuses in the approved order with sentence-case labels", () => {
  expect([...BOOKING_STATUSES]).toEqual(["in_progress", "hold", "option", "confirmed", "cancelled", "completed"])
  expect(BOOKING_STATUSES.map(status => BOOKING_STATUS_LABELS[status])).toEqual(["In progress", "Hold", "Option", "Confirmed", "Cancelled", "Completed"])
  for (const status of BOOKING_STATUSES) {
    expect(bookingStatusSchema.safeParse(status).success).toBe(true)
    expect(BOOKING_TRANSITION_LABELS[status]).toMatch(/^[A-Z][a-z ]+$/)
  }
  expect(bookingStatusSchema.safeParse("pending").success).toBe(false)
})
it.each(BOOKING_STATUSES.flatMap(from => BOOKING_STATUSES.map(to => [from, to] as const)))("transition %s -> %s follows the approved graph", (from, to) => {
  const allowed = GRAPH[from].includes(to)
  expect(canTransitionBooking(from, to)).toBe(allowed)
  expect(bookingTransitionBlock(from, to, "2020-01-01", "2026-11-21")).toBe(allowed ? null : "not_allowed")
  expect([...BOOKING_TRANSITIONS[from]]).toEqual(GRAPH[from])
})
it.each([
  ["2026-11-20", null], ["2026-11-21", null], ["2026-11-22", "not_performed_yet"], ["", "not_performed_yet"],
] as const)("completion for a show on %j is %j when today is 2026-11-21", (date, block) => {
  expect(bookingTransitionBlock("confirmed", "completed", date, "2026-11-21")).toBe(block)
})
it("offers completion only once the show date is reached", () => {
  expect(allowedBookingTransitions("confirmed", "2026-11-22", "2026-11-21")).toEqual(["cancelled"])
  expect(allowedBookingTransitions("confirmed", "2026-11-21", "2026-11-21")).toEqual(["cancelled", "completed"])
  expect(allowedBookingTransitions("completed", "2020-01-01", "2026-11-21")).toEqual([])
  expect(allowedBookingTransitions("cancelled", "2030-01-01", "2026-11-21")).toEqual(["in_progress"])
})
it("derives hold expiry at read without changing the status", () => {
  expect(isHoldExpired({ status: "hold", hold_expires_on: "2026-11-20" }, "2026-11-21")).toBe(true)
  expect(isHoldExpired({ status: "hold", hold_expires_on: "2026-11-21" }, "2026-11-21")).toBe(false)
  expect(isHoldExpired({ status: "hold", hold_expires_on: null }, "2026-11-21")).toBe(false)
  expect(isHoldExpired({ status: "option", hold_expires_on: "2026-11-20" }, "2026-11-21")).toBe(false)
})
it("ranks holds of the same artist and date by creation time, then id", () => {
  const hold = (id: string, created_at: string, extra = {}) => ({ id, artist_id: "a", date: "2030-01-01", status: "hold" as const, created_at, ...extra })
  const list = [
    hold("c", "2026-01-03"), hold("b", "2026-01-01"), hold("a", "2026-01-01"),
    hold("other-date", "2025-01-01", { date: "2030-01-02" }), hold("other-artist", "2025-01-01", { artist_id: "z" }),
    hold("not-hold", "2025-01-01", { status: "option" as const }),
  ]
  expect(holdRank(list, list[2])).toEqual({ rank: 1, total: 3 })
  expect(holdRank(list, list[1])).toEqual({ rank: 2, total: 3 })
  expect(holdRank(list, list[0])).toEqual({ rank: 3, total: 3 })
  expect(holdRank(list, list[5])).toBeNull()
  expect(holdRank([], list[0])).toBeNull()
  expect(holdRankLabel({ rank: 2, total: 3 })).toBe("Hold priority 2 of 3")
  expect(holdRankLabel({ rank: 1, total: 1 })).toBeNull()
  expect(holdRankLabel(null)).toBeNull()
})
