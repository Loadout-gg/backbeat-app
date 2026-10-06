import { z } from "zod"
import { bookingFeeShape, validateBookingFeePair } from "./booking-fee"
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
const optionalBookingText = (max: number, label: string) => z.string().trim()
  .max(max, `${label} must be at most ${max} characters`).nullable().optional()
  .transform(value => value === "" ? null : value)

export const updateBookingSchema = z.object({
  ...bookingFeeShape,
  venue_name: optionalBookingText(200, "Venue name"),
  venue_address: optionalBookingText(1000, "Venue address"),
  contact_name_main: optionalBookingText(200, "Contact name"),
  contact_phone_main: optionalBookingText(100, "Phone number"),
  contact_email_main: optionalBookingText(254, "Email").refine(value => value == null || z.string().email().safeParse(value).success, "Enter a valid primary contact email"),
  date: date.optional(),
  start_time: time.optional(),
  duration_minutes: duration.nullable().optional(),
  notes: z.string().nullable().optional(),
  status: bookingStatusSchema.optional(),
}).superRefine(validateBookingFeePair)
