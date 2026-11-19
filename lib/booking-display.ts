import { BOOKING_STATUSES, type BookingStatus } from "./booking-status"

// Display-only helpers for booking surfaces. They never change stored values.

const TIME_PREFIX = /^([01]\d|2[0-3]):[0-5]\d/

/** Show a stored `time` value ("21:30:00" or "21:30") as 24-hour HH:MM. */
export function formatBookingTime(value: string | null | undefined): string {
  if (!value) return ""
  const match = TIME_PREFIX.exec(value)
  return match ? match[0] : value
}

type ArtistNameSource = { stage_name?: string | null; name?: string | null } | null | undefined

/** Same rule as the bookings list: stage name, then name, then an honest unknown. */
export function bookingArtistName(artist: ArtistNameSource): string {
  return artist?.stage_name || artist?.name || "Unknown artist"
}

export const BOOKING_STATUS_LABELS: Record<BookingStatus, string> = {
  in_progress: "In progress",
  confirmed: "Confirmed",
  cancelled: "Cancelled",
  completed: "Completed",
}

/** Aligned with the events page badge variants (theme tokens via Badge). */
export function bookingStatusBadgeVariant(status: BookingStatus) {
  switch (status) {
    case "confirmed":
      return "default" as const
    case "in_progress":
      return "secondary" as const
    case "cancelled":
      return "destructive" as const
    default:
      return "outline" as const
  }
}

export type BookingStatusFilter = BookingStatus | "all"

/** Unknown or repeated URL values fall back to "all" instead of an empty list. */
export function parseBookingStatusFilter(value: string | string[] | undefined): BookingStatusFilter {
  if (typeof value !== "string") return "all"
  return (BOOKING_STATUSES as readonly string[]).includes(value) ? value as BookingStatus : "all"
}

type DatedBooking = { id: string; date: string }

/** Upcoming = today or later (ascending); past = before today (most recent first). */
export function splitBookingsByDate<T extends DatedBooking>(bookings: readonly T[], today: string) {
  const byDate = (a: T, b: T) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id)
  const upcoming = bookings.filter((booking) => booking.date >= today).sort(byDate)
  const past = bookings.filter((booking) => booking.date < today).sort((a, b) => byDate(b, a))
  return { upcoming, past }
}

/** Date-only strings (YYYY-MM-DD) compare lexically. */
export function isPastBookingDate(date: string, today: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && date < today
}

type SameDayCandidate = { id: string; artist_id: string; date: string; status: BookingStatus }

/** Other non-cancelled bookings of the same artist on the same date. */
export function findSameDayBookings<T extends SameDayCandidate>(
  bookings: readonly T[],
  target: { artistId: string; date: string; excludeId?: string },
): T[] {
  if (!target.date) return []
  return bookings.filter((booking) =>
    booking.artist_id === target.artistId &&
    booking.date === target.date &&
    booking.status !== "cancelled" &&
    booking.id !== target.excludeId,
  )
}

export function sameDayWarning(count: number): string {
  return count === 1
    ? "This artist already has another booking on this date."
    : `This artist already has ${count} other bookings on this date.`
}
