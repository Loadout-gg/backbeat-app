import { z } from "zod"

/**
 * Booking -> event conversion (P5) and the optional promoter of a booking.
 * Pure rules and fixed copy; the server actions live in lib/actions/booking-events.ts.
 * The database mirrors: migrations/008_booking_event.sql.
 */

/** Event statuses, as the events_status_check constraint (migration 008). */
export const EVENT_STATUSES = ["in_progress", "confirmed", "cancelled"] as const
export type EventStatus = (typeof EVENT_STATUSES)[number]

/** A booking can be converted only in these statuses. Conversion never changes the status. */
export const CONVERTIBLE_BOOKING_STATUSES = ["confirmed", "completed"] as const

export function canConvertBookingToEvent(status: string): boolean {
  return (CONVERTIBLE_BOOKING_STATUSES as readonly string[]).includes(status)
}

/** SQLSTATE raised by backbeat_enforce_event_booking (migration 008): linked booking not confirmed/completed. */
export const EVENT_BOOKING_STATUS_SQLSTATE = "BB006"

/** Fixed user-facing copy: provider and database messages are never returned. */
export const BOOKING_EVENT_COPY = {
  notFound: "Booking not found",
  notConvertible: "An event can be created only from a confirmed or completed booking.",
  alreadyConverted: "An event already exists for this booking.",
  changed: "The booking changed while the event was being created. Reload and try again.",
  failed: "Unable to create the event. Please try again.",
  unconfirmed: "Unable to confirm whether the event was created. Reload the booking before retrying.",
  promoterGone: "The selected promoter no longer exists. Choose another promoter.",
} as const

/** "<stage name, else name> @ <venue>"; without a venue the title is the artist name alone. */
export function bookingEventTitle(
  artist: { stage_name?: string | null; name?: string | null } | null | undefined,
  venueName: string | null | undefined,
): string {
  const artistName = artist?.stage_name?.trim() || artist?.name?.trim() || "Unknown artist"
  const venue = venueName?.trim()
  return venue ? `${artistName} @ ${venue}` : artistName
}

/** Optional promoter of a booking: omitted = unchanged, null = cleared. */
export const bookingPromoterIdSchema = z.guid("Choose a valid promoter")

type ProviderError = { code?: string | null; message?: string | null; details?: string | null } | null | undefined

/**
 * A booking write refused by bookings_promoter_id_fkey: the promoter was deleted or belongs
 * to another workspace. Any other foreign-key failure is not a promoter problem.
 */
export function isBookingPromoterViolation(error: ProviderError): boolean {
  return error?.code === "23503"
    && `${error.message ?? ""} ${error.details ?? ""}`.includes("bookings_promoter_id_fkey")
}

export function promoterOptionLabel(promoter: { name: string; company_name: string | null }): string {
  return promoter.company_name ? `${promoter.name} (${promoter.company_name})` : promoter.name
}
