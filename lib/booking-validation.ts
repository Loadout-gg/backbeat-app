import { z } from "zod"
import { BOOKING_FEE_CURRENCIES, bookingFeeShape, validateBookingFeePair } from "./booking-fee"
import { BOOKING_STATUSES } from "./booking-status"
import { bookingPromoterIdSchema } from "./booking-event"
import { MAX_TAX_NOTE_LENGTH, bookingCommissionShape, validateBookingCommission } from "./booking-finance"

// Preserve the incumbent literal UUID-shaped format, including legacy variant bits.
export const bookingIdSchema = z.guid("Invalid booking ID")
export const bookingStatusSchema = z.enum(BOOKING_STATUSES)

const date = z.string().date("Enter a valid booking date")
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, "Enter a valid start time")
const duration = z.number().finite().int().min(0).max(2147483647)

export const createBookingSchema = z.object({
  artistId: z.guid("Choose a valid artist"),
  date,
  startTime: time,
  durationMinutes: duration,
  notes: z.string().optional(),
  promoterId: bookingPromoterIdSchema.optional(),
})
const optionalBookingText = (max: number, label: string) => z.string().trim()
  .max(max, `${label} must be at most ${max} characters`).nullable().optional()
  .transform(value => value === "" ? null : value)

export const updateBookingSchema = z.object({
  ...bookingFeeShape,
  ...bookingCommissionShape,
  // Not a column: the fee currency a fixed commission was entered in, when the fee is not sent.
  expected_fee_currency: z.enum(BOOKING_FEE_CURRENCIES).optional(),
  tax_note: optionalBookingText(MAX_TAX_NOTE_LENGTH, "Tax note"),
  venue_name: optionalBookingText(200, "Venue name"),
  venue_address: optionalBookingText(1000, "Venue address"),
  contact_name_main: optionalBookingText(200, "Contact name"),
  contact_phone_main: optionalBookingText(100, "Phone number"),
  contact_email_main: optionalBookingText(254, "Email").refine(value => value == null || z.string().email().safeParse(value).success, "Enter a valid primary contact email"),
  date: date.optional(),
  start_time: time.optional(),
  duration_minutes: duration.nullable().optional(),
  notes: z.string().nullable().optional(),
  hold_expires_on: z.string().date("Enter a valid hold expiry date").nullable().optional(),
  promoter_id: bookingPromoterIdSchema.nullable().optional(),
  // Status changes go through updateBookingStatus only (transition graph + compare-and-set).
  status: z.undefined("Change the booking status with the status control").optional(),
}).superRefine(validateBookingFeePair).superRefine(validateBookingCommission)
