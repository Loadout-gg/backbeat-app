import { z } from "zod"
import { BOOKING_STATUSES } from "./booking-status"

export const bookingIdSchema = z.string().uuid("Invalid booking ID")
export const bookingStatusSchema = z.enum(BOOKING_STATUSES)

const date = z.string().date("Enter a valid booking date")
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, "Enter a valid start time")
const duration = z.number().finite().int().min(0).max(2147483647)

export const createBookingSchema = z.object({
  artistId: z.string().uuid("Choose a valid artist"),
  date,
  startTime: time,
  durationMinutes: duration,
  notes: z.string().optional(),
})
export const updateBookingSchema = z.object({
  date: date.optional(),
  start_time: time.optional(),
  duration_minutes: duration.nullable().optional(),
  notes: z.string().nullable().optional(),
  status: bookingStatusSchema.optional(),
})
