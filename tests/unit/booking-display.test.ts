import { afterEach, expect, it, vi } from "vitest"
import {
  BOOKING_STATUS_LABELS,
  bookingArtistName,
  bookingStatusBadgeVariant,
  findSameDayBookings,
  formatBookingTime,
  isPastBookingDate,
  parseBookingStatusFilter,
  sameDayWarning,
  splitBookingsByDate,
} from "@/lib/booking-display"
import { configuredCalendarDay } from "@/lib/calendar-day"
import type { BookingStatus } from "@/lib/booking-status"

afterEach(() => vi.unstubAllEnvs())

it.each([
  ["21:30:00", "21:30"],
  ["09:05", "09:05"],
  ["00:00:00", "00:00"],
  ["23:59:59.123", "23:59"],
  ["", ""],
  [null, ""],
  [undefined, ""],
  ["not a time", "not a time"],
] as const)("formats stored time %j as %j", (value, expected) => {
  expect(formatBookingTime(value)).toBe(expected)
})

it.each([
  [{ stage_name: "DJ Luna", name: "Luna" }, "DJ Luna"],
  [{ stage_name: null, name: "Luna" }, "Luna"],
  [{ stage_name: "", name: "Luna" }, "Luna"],
  [{ stage_name: null, name: null }, "Unknown artist"],
  [null, "Unknown artist"],
  [undefined, "Unknown artist"],
] as const)("names artist %j as %j", (artist, expected) => {
  expect(bookingArtistName(artist)).toBe(expected)
})

it("labels every existing status in sentence case and maps the events-page badge variants", () => {
  expect(BOOKING_STATUS_LABELS).toEqual({
    in_progress: "In progress", hold: "Hold", option: "Option", confirmed: "Confirmed", cancelled: "Cancelled", completed: "Completed",
  })
  expect(bookingStatusBadgeVariant("confirmed")).toBe("default")
  expect(bookingStatusBadgeVariant("in_progress")).toBe("secondary")
  expect(bookingStatusBadgeVariant("cancelled")).toBe("destructive")
  expect(bookingStatusBadgeVariant("completed")).toBe("outline")
})

it.each([
  [undefined, "all"],
  ["confirmed", "confirmed"],
  ["in_progress", "in_progress"],
  ["completed", "completed"],
  ["cancelled", "cancelled"],
  ["pending", "all"],
  ["CONFIRMED", "all"],
  ["", "all"],
  [["confirmed", "cancelled"], "all"],
] as const)("parses status filter %j as %j", (value, expected) => {
  expect(parseBookingStatusFilter(value as string | string[] | undefined)).toBe(expected)
})

it("splits bookings into upcoming (today included, ascending) and past (most recent first)", () => {
  const rows = [
    { id: "b", date: "2026-11-20" },
    { id: "a", date: "2026-11-14" },
    { id: "old", date: "2026-01-01" },
    { id: "a2", date: "2026-11-20" },
    { id: "recent", date: "2026-11-13" },
  ]
  const { upcoming, past } = splitBookingsByDate(rows, "2026-11-14")
  expect(upcoming.map(row => row.id)).toEqual(["a", "a2", "b"])
  expect(past.map(row => row.id)).toEqual(["recent", "old"])
  expect(rows.map(row => row.id)).toEqual(["b", "a", "old", "a2", "recent"])
})

it("treats only dates before today as past", () => {
  expect(isPastBookingDate("2026-11-13", "2026-11-14")).toBe(true)
  expect(isPastBookingDate("2026-11-14", "2026-11-14")).toBe(false)
  expect(isPastBookingDate("2027-01-01", "2026-11-14")).toBe(false)
  expect(isPastBookingDate("", "2026-11-14")).toBe(false)
  expect(isPastBookingDate("garbage", "2026-11-14")).toBe(false)
})

it("finds other non-cancelled bookings of the same artist on the same date", () => {
  const row = (id: string, artist_id: string, date: string, status: BookingStatus) => ({ id, artist_id, date, status })
  const rows = [
    row("self", "artist-a", "2026-12-01", "in_progress"),
    row("same", "artist-a", "2026-12-01", "confirmed"),
    row("done", "artist-a", "2026-12-01", "completed"),
    row("cancelled", "artist-a", "2026-12-01", "cancelled"),
    row("other-artist", "artist-b", "2026-12-01", "confirmed"),
    row("other-day", "artist-a", "2026-12-02", "confirmed"),
  ]
  expect(findSameDayBookings(rows, { artistId: "artist-a", date: "2026-12-01", excludeId: "self" }).map(r => r.id))
    .toEqual(["same", "done"])
  expect(findSameDayBookings(rows, { artistId: "artist-a", date: "2026-12-01" })).toHaveLength(3)
  expect(findSameDayBookings(rows, { artistId: "artist-a", date: "" })).toEqual([])
})

it("words the same-day notice for one and several bookings", () => {
  expect(sameDayWarning(1)).toBe("This artist already has another booking on this date.")
  expect(sameDayWarning(3)).toBe("This artist already has 3 other bookings on this date.")
})

it("derives today from the configured calendar zone, defaulting to UTC", () => {
  const instant = new Date("2026-11-14T23:30:00Z")
  expect(configuredCalendarDay(instant)).toBe("2026-11-14")
  vi.stubEnv("BACKBEAT_CALENDAR_TIME_ZONE", "Europe/Rome")
  expect(configuredCalendarDay(instant)).toBe("2026-11-15")
})
