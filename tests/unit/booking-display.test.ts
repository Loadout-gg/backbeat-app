import { afterEach, expect, it, vi } from "vitest"
import {
  BOOKING_STATUS_LABELS,
  bookingArtistName,
  bookingStatusBadgeVariant,
  bookingTimeSortKey,
  compareBookingSchedule,
  findSameDayBookings,
  formatBookingTime,
  formatBookingTimeRange,
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

it.each([
  ["21:30:00", null, "21:30"],
  ["21:30:00", 0, "21:30"],
  ["21:30:00", 90, "21:30–23:00"],
  ["22:00", 120, "22:00–00:00 (next day)"],
  ["23:00:00", 150, "23:00–01:30 (next day)"],
  ["00:30:00", 60, "00:30–01:30"],
  ["", 60, ""],
  ["not a time", 60, "not a time"],
] as const)("shows start %j with duration %j as %j", (start, duration, expected) => {
  expect(formatBookingTimeRange(start, duration)).toBe(expected)
})

it("orders same-day bookings by start time, untimed last, then id", () => {
  const rows = [
    { id: "c", date: "2030-01-02", start_time: "" },
    { id: "b", date: "2030-01-02", start_time: "23:00:00" },
    { id: "a", date: "2030-01-02", start_time: "09:00:00" },
    { id: "z", date: "2030-01-01", start_time: "23:59:00" },
    { id: "a2", date: "2030-01-02", start_time: "09:00:00" },
  ]
  expect([...rows].sort(compareBookingSchedule).map(row => row.id)).toEqual(["z", "a", "a2", "b", "c"])
  expect(bookingTimeSortKey("09:00:00")).toBeLessThan(bookingTimeSortKey(null))
})

it("orders a past same-day group latest first", () => {
  const { past } = splitBookingsByDate([
    { id: "early", date: "2026-11-10", start_time: "18:00:00" },
    { id: "late", date: "2026-11-10", start_time: "22:00:00" },
  ], "2026-11-14")
  expect(past.map(row => row.id)).toEqual(["late", "early"])
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
