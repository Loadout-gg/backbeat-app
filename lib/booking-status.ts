export const BOOKING_STATUSES = ["in_progress", "confirmed", "cancelled", "completed"] as const
export type BookingStatus = (typeof BOOKING_STATUSES)[number]
