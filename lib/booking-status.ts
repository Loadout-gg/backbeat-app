export const BOOKING_STATUSES = ["in_progress", "hold", "option", "confirmed", "cancelled", "completed"] as const
export type BookingStatus = (typeof BOOKING_STATUSES)[number]

/**
 * Status transition graph (P1). The database trigger in
 * migrations/006_booking_lifecycle.sql enforces the same graph for every writer;
 * this copy lets the server action and the UI answer without a round trip.
 */
export const BOOKING_TRANSITIONS: Readonly<Record<BookingStatus, readonly BookingStatus[]>> = {
  in_progress: ["hold", "option", "confirmed", "cancelled"],
  hold: ["option", "confirmed", "cancelled", "in_progress"],
  option: ["confirmed", "cancelled", "hold"],
  confirmed: ["cancelled", "completed"],
  cancelled: ["in_progress"],
  completed: [],
}

export function canTransitionBooking(from: BookingStatus, to: BookingStatus): boolean {
  return BOOKING_TRANSITIONS[from].includes(to)
}

export type BookingTransitionBlock = "not_allowed" | "not_performed_yet"

/**
 * Why a transition is refused, or null when it is allowed.
 * `completed` means the show was performed: only on or after the booking date
 * (date-only strings compare lexically; `today` comes from the configured calendar zone).
 */
export function bookingTransitionBlock(
  from: BookingStatus,
  to: BookingStatus,
  date: string,
  today: string,
): BookingTransitionBlock | null {
  if (!canTransitionBooking(from, to)) return "not_allowed"
  if (to === "completed" && !(/^\d{4}-\d{2}-\d{2}$/.test(date) && date <= today)) return "not_performed_yet"
  return null
}

export function allowedBookingTransitions(from: BookingStatus, date: string, today: string): BookingStatus[] {
  return BOOKING_TRANSITIONS[from].filter((to) => bookingTransitionBlock(from, to, date, today) === null)
}
