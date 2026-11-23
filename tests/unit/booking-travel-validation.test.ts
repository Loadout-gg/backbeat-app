import { expect, it } from "vitest"
import {
  bookingStaySchema, dateOfBirthSchema, travelDocumentSchema, travelLegSchema,
} from "@/lib/booking-travel-validation"

const leg = (patch: Record<string, unknown> = {}) => travelLegSchema.safeParse({ direction: "inbound", ...patch })
const issue = (result: { success: boolean; error?: { issues: { message: string }[] } }) =>
  result.success ? null : result.error!.issues[0].message

it("normalizes a full leg: trims text, blank optional fields become NULL", () => {
  const result = leg({ mode: " flight ", carrier: "", depart_date: "2030-05-02", depart_time: "09:00", arrive_time: "" })
  expect(result.success).toBe(true)
  expect(result.data).toMatchObject({ mode: "flight", carrier: null, depart_date: "2030-05-02", depart_time: "09:00", arrive_time: null, notes: null })
})
it.each([
  [{ direction: "sideways" }, "Choose a direction"],
  [{ depart_date: "2030-02-30" }, "Enter a valid departure date"],
  [{ depart_date: "2030-05-02", depart_time: "25:00" }, "Enter a valid departure time"],
  [{ depart_time: "09:00" }, "Enter the departure date for the departure time"],
  [{ arrive_time: "09:00" }, "Enter the arrival date for the arrival time"],
  [{ depart_date: "2030-05-02", arrive_date: "2030-05-01" }, "Arrival cannot be before departure"],
  [{ depart_date: "2030-05-02", depart_time: "10:00", arrive_date: "2030-05-02", arrive_time: "09:59" }, "Arrival cannot be before departure"],
  [{ depart_date: "2030-05-02", depart_time: "10:00", depart_zone: "cet", arrive_date: "2030-05-02", arrive_time: "09:00", arrive_zone: " CET " }, "Arrival cannot be before departure"],
  [{ notes: "x".repeat(2001) }, "Notes must be at most 2000 characters"],
  [{ driver_phone: "1".repeat(101) }, "Driver phone must be at most 100 characters"],
  [{ depart_zone: "z".repeat(65) }, "Departure time zone must be at most 64 characters"],
])("rejects leg %j with fixed copy", (patch, message) => {
  expect(issue(leg(patch))).toBe(message)
})
it("compares clock times only for the same date and the same zone label", () => {
  expect(leg({ depart_date: "2030-05-02", depart_time: "10:00", depart_zone: "Tokyo", arrive_date: "2030-05-02", arrive_time: "09:00", arrive_zone: "Honolulu" }).success).toBe(true)
  expect(leg({ depart_date: "2030-05-02", depart_time: "10:00:00", arrive_date: "2030-05-02", arrive_time: "10:00" }).success).toBe(true)
  expect(leg({ depart_date: "2030-05-02", depart_time: "23:00", arrive_date: "2030-05-03", arrive_time: "01:00" }).success).toBe(true)
})
it("rejects unknown leg keys (no workspace or booking override from the client)", () => {
  expect(leg({ workspace_id: "x" }).success).toBe(false)
  expect(leg({ booking_id: "x" }).success).toBe(false)
})
it("validates stays: name required, check-out not before check-in, same day allowed", () => {
  expect(issue(bookingStaySchema.safeParse({ name: "  " }))).toBe("Enter the accommodation name")
  expect(issue(bookingStaySchema.safeParse({}))).toBe("Enter the accommodation name")
  expect(issue(bookingStaySchema.safeParse({ name: "Hotel", check_in_on: "2030-05-02", check_out_on: "2030-05-01" }))).toBe("Check-out cannot be before check-in")
  expect(bookingStaySchema.safeParse({ name: "Hotel", check_in_on: "2030-05-02", check_out_on: "2030-05-02" }).success).toBe(true)
  expect(bookingStaySchema.parse({ name: " Hotel ", address: "" })).toMatchObject({ name: "Hotel", address: null, check_in_on: null })
  expect(issue(bookingStaySchema.safeParse({ name: "x".repeat(201) }))).toBe("Accommodation name must be at most 200 characters")
})
it("validates travel documents", () => {
  expect(travelDocumentSchema.parse({ doc_type: "passport", number: " YA1 ", expires_on: "" })).toEqual({
    doc_type: "passport", number: "YA1", issuing_country: null, expires_on: null, holder_name: null,
  })
  expect(issue(travelDocumentSchema.safeParse({ doc_type: "visa", number: "1" }))).toBe("Choose a document type")
  expect(issue(travelDocumentSchema.safeParse({ doc_type: "id_card", number: " " }))).toBe("Enter the document number")
  expect(issue(travelDocumentSchema.safeParse({ doc_type: "id_card", number: "1".repeat(65) }))).toBe("Document number must be at most 64 characters")
  expect(travelDocumentSchema.safeParse({ doc_type: "other", number: "1", artist_id: "x" }).success).toBe(false)
})
it("validates the date of birth against 1900 and the configured today", () => {
  const schema = dateOfBirthSchema("2026-11-23")
  expect(schema.parse("")).toBeNull()
  expect(schema.parse(null)).toBeNull()
  expect(schema.parse("1990-02-03")).toBe("1990-02-03")
  expect(schema.parse("2026-11-23")).toBe("2026-11-23")
  expect(issue(schema.safeParse("2026-11-24"))).toBe("Date of birth cannot be in the future")
  expect(issue(schema.safeParse("1899-12-31"))).toBe("Enter a date of birth from 1900 onwards")
  expect(issue(schema.safeParse("1990-13-01"))).toBe("Enter a valid date of birth")
})
