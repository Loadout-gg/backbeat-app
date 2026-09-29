import { expect, it } from "vitest"
import { calendarDay } from "@/lib/calendar-day"
// Boundary coverage supplements the page-level RED/GREEN; these are characterization tests.
it.each([
  ["2026-09-30T21:59:59Z", "Europe/Rome", "2026-09-30"],
  ["2026-09-30T22:00:00Z", "Europe/Rome", "2026-10-01"],
  ["2026-12-31T23:00:00Z", "Europe/Rome", "2027-01-01"],
  ["2026-03-29T00:30:00Z", "Europe/Rome", "2026-03-29"],
  ["2026-03-29T01:30:00Z", "Europe/Rome", "2026-03-29"],
  ["2026-10-25T00:30:00Z", "Europe/Rome", "2026-10-25"],
  ["2026-10-25T01:30:00Z", "Europe/Rome", "2026-10-25"],
  ["2026-09-30T22:30:00Z", "UTC", "2026-09-30"],
  ["2026-10-01T01:00:00Z", "America/Los_Angeles", "2026-09-30"],
])("formats %s in %s as the stable date-only day %s", (instant, zone, expected) => {
  expect(calendarDay(new Date(instant), zone)).toBe(expected)
})
it("fails explicitly for an invalid timezone rather than using host-local time", () => {
  expect(() => calendarDay(new Date("2026-09-30T22:30:00Z"), "invalid-zone")).toThrow(RangeError)
})
