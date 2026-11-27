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
export const EVENT_BOOKING_STATUS_SQLSTATE = "BB008"
/** SQLSTATE raised by backbeat_cancel_booking_event (migration 008): a converted booking leaves cancelled. */
export const CONVERTED_BOOKING_CANCELLED_SQLSTATE = "BB009"
/** SQLSTATE raised by backbeat_keep_cancelled_event (migration 008): the event of a cancelled booking is reactivated or unlinked. */
export const CANCELLED_BOOKING_EVENT_SQLSTATE = "BB010"
/** SQLSTATE raised by backbeat_keep_booking_with_event (migration 008): a booking that has an event is deleted. */
export const BOOKING_WITH_EVENT_DELETE_SQLSTATE = "BB011"

/** Fixed user-facing copy: provider and database messages are never returned. */
export const BOOKING_EVENT_COPY = {
  notFound: "Booking not found",
  notConvertible: "An event can be created only from a confirmed or completed booking.",
  changed: "The booking changed while the event was being created. Reload and try again.",
  failed: "Unable to create the event. Please try again.",
  unconfirmed: "Unable to confirm whether the event was created. Reload the booking before retrying.",
  promoterGone: "The selected promoter no longer exists. Choose another promoter.",
  /** BB009: cancelling a converted booking is final; its event stays cancelled. */
  convertedStaysCancelled: "This booking has an event and was cancelled, so it cannot be reopened. Create a new booking to rebook.",
  /** BB010: the event follows its cancelled booking. */
  eventStaysCancelled: "This event was cancelled with its booking and cannot be reopened. Create a new booking to rebook.",
  /** BB011: a booking that has an event is kept; cancelling it cancels the event too. */
  bookingHasEvent: "This booking has an event, so it cannot be deleted. Cancel the booking instead; its event is cancelled with it.",
  /** An event created from a booking is never deleted (owner rule 2026-11-27); it follows its booking. */
  eventFromBookingDelete: "This event was created from a booking, so it cannot be deleted. Cancel the booking instead; the event is cancelled with it and kept as history.",
  /** Shown instead of the delete section on an event created from a booking. */
  eventFromBookingNotice: "Created from a booking: cancel the booking instead. The event is cancelled with it and kept as history.",
  /** Event page: the status control is read-only while the linked booking is cancelled (BB010 would refuse a change). */
  eventStatusLocked: "This event was cancelled with its booking, so its status cannot change. Create a new booking to rebook.",
  /** Booking editor: a cancelled booking that has an event is never reopened (BB009). */
  rebook: "Rebook with a new booking.",
} as const

/**
 * Fixed copy for a refusal raised by a 008 trigger (BB008–BB011); null for any other error.
 * The provider message is never returned.
 */
export function bookingEventErrorCopy(error: { code?: string | null } | null | undefined): string | null {
  switch (error?.code) {
    case EVENT_BOOKING_STATUS_SQLSTATE: return BOOKING_EVENT_COPY.notConvertible
    case CONVERTED_BOOKING_CANCELLED_SQLSTATE: return BOOKING_EVENT_COPY.convertedStaysCancelled
    case CANCELLED_BOOKING_EVENT_SQLSTATE: return BOOKING_EVENT_COPY.eventStaysCancelled
    case BOOKING_WITH_EVENT_DELETE_SQLSTATE: return BOOKING_EVENT_COPY.bookingHasEvent
    default: return null
  }
}

/** Confirmation copy for "Cancel booking". linkedEvent: true = has one, false = none, "unknown" = read failed. */
export function cancelBookingConfirmCopy(linkedEvent: boolean | "unknown"): string {
  const payments = "Recorded payments are kept; void them separately if needed."
  if (linkedEvent === true) {
    return `This cannot be undone. The event created from this booking is cancelled with it and kept as history, and the booking cannot be reopened: to rebook, create a new booking. ${payments}`
  }
  if (linkedEvent === "unknown") {
    return `The event of this booking could not be checked. If it has one, cancelling cannot be undone: the event is cancelled with it and the booking cannot be reopened. ${payments}`
  }
  return `The booking moves to cancelled. It has no event, so it can be reopened as in progress later. ${payments}`
}

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

/**
 * A booking delete refused because an event is linked to it: BB011 from the delete trigger,
 * or 23503 from events_booking_id_fkey when the event was linked while the delete ran.
 */
export function isBookingWithEventDeleteViolation(error: ProviderError): boolean {
  if (error?.code === BOOKING_WITH_EVENT_DELETE_SQLSTATE) return true
  return error?.code === "23503"
    && `${error.message ?? ""} ${error.details ?? ""}`.includes("events_booking_id_fkey")
}

export function promoterOptionLabel(promoter: { name: string; company_name: string | null }): string {
  return promoter.company_name ? `${promoter.name} (${promoter.company_name})` : promoter.name
}
