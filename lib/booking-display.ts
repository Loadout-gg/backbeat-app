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
  hold: "Hold",
  option: "Option",
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
    case "hold":
    case "option":
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

/** Button copy for moving a booking to a status. */
export const BOOKING_TRANSITION_LABELS: Record<BookingStatus, string> = {
  in_progress: "Reopen as in progress",
  hold: "Place on hold",
  option: "Mark as option",
  confirmed: "Confirm booking",
  cancelled: "Cancel booking",
  completed: "Mark as completed",
}

type HoldCandidate = {
  id: string; artist_id: string; date: string; status: BookingStatus
  created_at?: string | null; hold_expires_on?: string | null
}

/** Derived at read, never stored: a hold whose expiry date is before today. */
export function isHoldExpired(booking: Pick<HoldCandidate, "status" | "hold_expires_on">, today: string): boolean {
  return booking.status === "hold" && !!booking.hold_expires_on && booking.hold_expires_on < today
}

/**
 * Derived hold priority: position among the holds of the same artist and date,
 * ordered by creation time then id. Null when the booking is not a hold or is not in the list.
 */
export function holdRank<T extends HoldCandidate>(
  bookings: readonly T[],
  target: Pick<HoldCandidate, "id" | "artist_id" | "date" | "status">,
): { rank: number; total: number } | null {
  if (target.status !== "hold") return null
  const holds = bookings
    .filter((booking) => booking.status === "hold" && booking.artist_id === target.artist_id && booking.date === target.date)
    .sort((a, b) => (a.created_at ?? "").localeCompare(b.created_at ?? "") || a.id.localeCompare(b.id))
  const index = holds.findIndex((booking) => booking.id === target.id)
  return index === -1 ? null : { rank: index + 1, total: holds.length }
}

/** Shown only when more than one hold competes for the same artist and date. */
export function holdRankLabel(position: { rank: number; total: number } | null): string | null {
  return position && position.total > 1 ? `Hold priority ${position.rank} of ${position.total}` : null
}
