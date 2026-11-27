import { z } from "zod"

// Validation for booking travel legs, stays and artist travel documents (migration 009).
// Every limit mirrors a CHECK in migrations/009_booking_travel_stays.sql. Inputs are full
// replacements: a missing or blank optional field is stored as NULL.

export const TRAVEL_DIRECTIONS = ["inbound", "outbound", "other"] as const
export type TravelDirection = (typeof TRAVEL_DIRECTIONS)[number]
export const TRAVEL_DIRECTION_LABELS: Record<TravelDirection, string> = {
  inbound: "Inbound",
  outbound: "Outbound",
  other: "Other",
}

export const TRAVEL_DOCUMENT_TYPES = ["passport", "id_card", "other"] as const
export type TravelDocumentType = (typeof TRAVEL_DOCUMENT_TYPES)[number]
export const TRAVEL_DOCUMENT_TYPE_LABELS: Record<TravelDocumentType, string> = {
  passport: "Passport",
  id_card: "ID card",
  other: "Other",
}

export const travelRecordIdSchema = z.guid("Invalid ID")

const optionalText = (max: number, label: string) => z.string().trim()
  .max(max, `${label} must be at most ${max} characters`).nullable().optional()
  .transform(value => value ? value : null)
const requiredText = (max: number, label: string, missing: string) => z.string(missing).trim()
  .min(1, missing).max(max, `${label} must be at most ${max} characters`)
const optionalDate = (message: string) => z.union([z.literal(""), z.string().date(message)], message)
  .nullable().optional().transform(value => value ? value : null)
const optionalTime = (message: string) => z.union([
  z.literal(""), z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, message),
], message).nullable().optional().transform(value => value ? value : null)

/** Normalized for comparison only: "HH:MM" and "HH:MM:SS" compare as the same instant of day. */
function clockKey(time: string): string {
  return time.length === 5 ? `${time}:00` : time
}
/** Zone labels are free text; equal labels (ignoring case and spaces at the ends) mean "same clock". */
function zoneKey(zone: string | null): string {
  return (zone ?? "").trim().toLowerCase()
}
/** Both labels set and different: the two local clocks are not comparable. */
function zonesDiffer(departZone: string | null, arriveZone: string | null): boolean {
  const depart = zoneKey(departZone)
  const arrive = zoneKey(arriveZone)
  return depart !== "" && arrive !== "" && depart !== arrive
}
/** Calendar day before a YYYY-MM-DD date (UTC arithmetic, no zone involved). */
function previousDay(date: string): string {
  const day = new Date(`${date}T00:00:00Z`)
  day.setUTCDate(day.getUTCDate() - 1)
  return day.toISOString().slice(0, 10)
}

export const travelLegSchema = z.object({
  direction: z.enum(TRAVEL_DIRECTIONS, "Choose a direction"),
  mode: optionalText(50, "Mode"),
  carrier: optionalText(200, "Carrier"),
  reference: optionalText(100, "Reference"),
  depart_place: optionalText(300, "Departure place"),
  depart_date: optionalDate("Enter a valid departure date"),
  depart_time: optionalTime("Enter a valid departure time"),
  depart_zone: optionalText(64, "Departure time zone"),
  arrive_place: optionalText(300, "Arrival place"),
  arrive_date: optionalDate("Enter a valid arrival date"),
  arrive_time: optionalTime("Enter a valid arrival time"),
  arrive_zone: optionalText(64, "Arrival time zone"),
  travellers: optionalText(1000, "Travellers"),
  driver_name: optionalText(200, "Driver name"),
  driver_phone: optionalText(100, "Driver phone"),
  notes: optionalText(2000, "Notes"),
}).strict().superRefine((leg, ctx) => {
  if (leg.depart_time && !leg.depart_date) {
    ctx.addIssue({ code: "custom", path: ["depart_date"], message: "Enter the departure date for the departure time" })
  }
  if (leg.arrive_time && !leg.arrive_date) {
    ctx.addIssue({ code: "custom", path: ["arrive_date"], message: "Enter the arrival date for the arrival time" })
  }
  if (leg.depart_date && leg.arrive_date) {
    // Mirrors booking_travel_legs_order_check (migration 009). Different, both-set zone labels:
    // local clocks are not compared (decision 2) and the arrival date may be one day earlier
    // (date-line crossing, Simone 2026-11-23). Otherwise strict date and same-date time order.
    if (zonesDiffer(leg.depart_zone, leg.arrive_zone)) {
      if (leg.arrive_date < previousDay(leg.depart_date)) {
        ctx.addIssue({ code: "custom", path: ["arrive_date"], message: "Arrival can be at most one day before departure across time zones" })
      }
    } else if (leg.arrive_date < leg.depart_date) {
      ctx.addIssue({ code: "custom", path: ["arrive_date"], message: "Arrival cannot be before departure" })
    } else if (
      leg.arrive_date === leg.depart_date && leg.depart_time && leg.arrive_time
      && clockKey(leg.arrive_time) < clockKey(leg.depart_time)
    ) {
      ctx.addIssue({ code: "custom", path: ["arrive_time"], message: "Arrival cannot be before departure" })
    }
  }
})
export type TravelLegInput = z.input<typeof travelLegSchema>
export type TravelLegValues = z.output<typeof travelLegSchema>

export const bookingStaySchema = z.object({
  name: requiredText(200, "Accommodation name", "Enter the accommodation name"),
  address: optionalText(1000, "Address"),
  check_in_on: optionalDate("Enter a valid check-in date"),
  check_out_on: optionalDate("Enter a valid check-out date"),
  confirmation_ref: optionalText(100, "Confirmation reference"),
  notes: optionalText(2000, "Notes"),
}).strict().superRefine((stay, ctx) => {
  if (stay.check_in_on && stay.check_out_on && stay.check_out_on < stay.check_in_on) {
    ctx.addIssue({ code: "custom", path: ["check_out_on"], message: "Check-out cannot be before check-in" })
  }
})
export type BookingStayInput = z.input<typeof bookingStaySchema>
export type BookingStayValues = z.output<typeof bookingStaySchema>

// Data card (owner decision D4): nationality and issue date are optional and separate from the
// issuing country, the expiry date and the name exactly as printed on the document.
export const travelDocumentSchema = z.object({
  doc_type: z.enum(TRAVEL_DOCUMENT_TYPES, "Choose a document type"),
  number: requiredText(64, "Document number", "Enter the document number"),
  issuing_country: optionalText(100, "Issuing country"),
  nationality: optionalText(100, "Nationality"),
  issued_on: optionalDate("Enter a valid issue date"),
  expires_on: optionalDate("Enter a valid expiry date"),
  holder_name: optionalText(200, "Name on document"),
}).strict()
export type TravelDocumentInput = z.input<typeof travelDocumentSchema>
export type TravelDocumentValues = z.output<typeof travelDocumentSchema>

// Deal term "transport to the city" (owner decision D6, owner parameter 2026-11-27): who
// organizes and pays travel to the venue city. One booking field, independent of the mode of
// any travel leg. Landed deal = artist; promoter pays flights = promoter; all-in = artist.
export const TRANSPORT_TO_CITY_VALUES = ["promoter", "artist", "not_needed"] as const
export type TransportToCity = (typeof TRANSPORT_TO_CITY_VALUES)[number]
export const TRANSPORT_TO_CITY_LABELS: Record<TransportToCity, string> = {
  promoter: "Promoter organizes and pays",
  artist: "Artist organizes and pays",
  not_needed: "Not needed",
}
export const transportToCitySchema = z.union([z.literal(""), z.enum(TRANSPORT_TO_CITY_VALUES)], "Choose who handles transport to the city")
  .nullable().transform(value => value ? value : null)

export const EARLIEST_DATE_OF_BIRTH = "1900-01-01"
/** `today` is the configured calendar day; a birth date in the future is rejected. */
export function dateOfBirthSchema(today: string) {
  return optionalDate("Enter a valid date of birth")
    .refine(value => value === null || value >= EARLIEST_DATE_OF_BIRTH, "Enter a date of birth from 1900 onwards")
    .refine(value => value === null || value <= today, "Date of birth cannot be in the future")
}

/** First validation message, for the fixed single-line error area of each form. */
export function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Check the details and try again."
}
