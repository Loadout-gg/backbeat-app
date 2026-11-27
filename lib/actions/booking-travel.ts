"use server"

import { revalidatePath } from "next/cache"
import { readCompleteCollection } from "@/lib/read-complete-collection"
import { createClient } from "@/lib/supabase/server"
import { getCurrentWorkspaceId } from "./workspace"
import {
  bookingStaySchema, firstIssue, transportToCitySchema, travelLegSchema, travelRecordIdSchema,
  type BookingStayInput, type TransportToCity, type TravelDirection, type TravelLegInput,
} from "@/lib/booking-travel-validation"

// Travel legs and stays of one booking (migration 009). Explicit projections only: these rows
// carry personal data (travellers, driver phone), so they never join list, selector or
// dashboard reads. Errors return fixed copy; only the provider error code is logged.

export interface TravelLeg {
  id: string
  booking_id: string
  direction: TravelDirection
  mode: string | null
  carrier: string | null
  reference: string | null
  depart_place: string | null
  depart_date: string | null
  depart_time: string | null
  depart_zone: string | null
  arrive_place: string | null
  arrive_date: string | null
  arrive_time: string | null
  arrive_zone: string | null
  travellers: string | null
  driver_name: string | null
  driver_phone: string | null
  notes: string | null
}

export interface BookingStay {
  id: string
  booking_id: string
  name: string
  address: string | null
  check_in_on: string | null
  check_out_on: string | null
  confirmation_ref: string | null
  notes: string | null
}

export interface BookingTravel {
  legs: TravelLeg[]
  stays: BookingStay[]
  /** Who organizes and pays travel to the venue city (D6); null = not set. */
  transportToCity: TransportToCity | null
}

export type TravelActionResult = { success: true } | { success: false; error: string }

const LEG_COLUMNS = "id,booking_id,direction,mode,carrier,reference,depart_place,depart_date,depart_time,depart_zone,arrive_place,arrive_date,arrive_time,arrive_zone,travellers,driver_name,driver_phone,notes"
const STAY_COLUMNS = "id,booking_id,name,address,check_in_on,check_out_on,confirmation_ref,notes"

const BOOKING_NOT_FOUND = "Booking not found"
const LEG_NOT_FOUND = "Travel leg not found"
const STAY_NOT_FOUND = "Accommodation not found"
const LOAD_FAILED = "Unable to load travel and accommodation. Please try again."
const LEG_SAVE_FAILED = "Unable to save the travel leg. Please try again."
const LEG_DELETE_FAILED = "Unable to delete the travel leg. Please try again."
const STAY_SAVE_FAILED = "Unable to save the accommodation. Please try again."
const STAY_DELETE_FAILED = "Unable to delete the accommodation. Please try again."
const TRANSPORT_SAVE_FAILED = "Unable to save transport to the city. Please try again."
// A CHECK the client schema did not catch (for example a stale client): fixed copy, no details.
const REJECTED_BY_DATABASE = "These details were not accepted. Check dates and lengths and try again."

type ProviderError = { code?: string | null } | null

/** Logs only the SQLSTATE: provider messages and details can echo the submitted values. */
function logFailure(label: string, error: ProviderError) {
  console.error(label, { code: error?.code ?? "unknown" })
}

function writeErrorMessage(error: ProviderError, fallback: string): string {
  if (error?.code === "23503") return BOOKING_NOT_FOUND
  if (error?.code === "23514") return REJECTED_BY_DATABASE
  return fallback
}

async function scopedClient() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  return { supabase, workspaceId: await getCurrentWorkspaceId() }
}

function revalidateBooking(bookingId: string) {
  revalidatePath(`/dashboard/bookings/${bookingId}`)
}

/** Complete legs and stays of one booking in the selected workspace. Rejects on any failure. */
export async function getBookingTravel(bookingId: string): Promise<BookingTravel> {
  if (!travelRecordIdSchema.safeParse(bookingId).success) throw new Error("Invalid booking ID")
  const scope = await scopedClient()
  if (!scope) throw new Error("Not authenticated")
  const { supabase, workspaceId } = scope
  try {
    const [legs, stays, transportToCity] = await Promise.all([
      readCompleteCollection<TravelLeg>(async (from, to) => {
        const { data, error, count } = await supabase.from("booking_travel_legs")
          .select(LEG_COLUMNS, { count: "exact" })
          .eq("workspace_id", workspaceId).eq("booking_id", bookingId)
          .order("depart_date", { ascending: true, nullsFirst: false })
          .order("depart_time", { ascending: true, nullsFirst: false })
          .order("created_at", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to)
        return { data: data as TravelLeg[] | null, error, count }
      }, "Travel legs"),
      readCompleteCollection<BookingStay>(async (from, to) => {
        const { data, error, count } = await supabase.from("booking_stays")
          .select(STAY_COLUMNS, { count: "exact" })
          .eq("workspace_id", workspaceId).eq("booking_id", bookingId)
          .order("check_in_on", { ascending: true, nullsFirst: false })
          .order("created_at", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to)
        return { data: data as BookingStay[] | null, error, count }
      }, "Stays"),
      // The deal term lives on the booking row; it is read here so booking list and editor
      // projections stay as they are.
      (async () => {
        const { data, error } = await supabase.from("bookings")
          .select("id,transport_to_city")
          .eq("id", bookingId).eq("workspace_id", workspaceId)
          .maybeSingle()
        if (error || !data) throw new Error("booking read failed")
        return (data as { transport_to_city: TransportToCity | null }).transport_to_city
      })(),
    ])
    return { legs, stays, transportToCity }
  } catch {
    console.error("Error loading booking travel")
    throw new Error(LOAD_FAILED)
  }
}

export async function createTravelLeg(bookingId: string, input: TravelLegInput): Promise<TravelActionResult> {
  if (!travelRecordIdSchema.safeParse(bookingId).success) return { success: false, error: "Invalid booking ID" }
  const parsed = travelLegSchema.safeParse(input)
  if (!parsed.success) return { success: false, error: firstIssue(parsed.error) }
  const scope = await scopedClient()
  if (!scope) return { success: false, error: "Not authenticated" }
  const { data, error } = await scope.supabase.from("booking_travel_legs")
    .insert({ ...parsed.data, workspace_id: scope.workspaceId, booking_id: bookingId })
    .select("id").maybeSingle()
  if (error) {
    logFailure("Error creating travel leg:", error)
    return { success: false, error: writeErrorMessage(error, LEG_SAVE_FAILED) }
  }
  if (!data) return { success: false, error: LEG_SAVE_FAILED }
  revalidateBooking(bookingId)
  return { success: true }
}

export async function updateTravelLeg(bookingId: string, legId: string, input: TravelLegInput): Promise<TravelActionResult> {
  if (!travelRecordIdSchema.safeParse(bookingId).success || !travelRecordIdSchema.safeParse(legId).success) {
    return { success: false, error: LEG_NOT_FOUND }
  }
  const parsed = travelLegSchema.safeParse(input)
  if (!parsed.success) return { success: false, error: firstIssue(parsed.error) }
  const scope = await scopedClient()
  if (!scope) return { success: false, error: "Not authenticated" }
  // Affected-row witness: zero rows means missing, deleted elsewhere or outside the workspace.
  const { data, error } = await scope.supabase.from("booking_travel_legs")
    .update({ ...parsed.data, updated_at: new Date().toISOString() })
    .eq("id", legId).eq("booking_id", bookingId).eq("workspace_id", scope.workspaceId)
    .select("id").maybeSingle()
  if (error) {
    logFailure("Error updating travel leg:", error)
    return { success: false, error: writeErrorMessage(error, LEG_SAVE_FAILED) }
  }
  if (!data) return { success: false, error: LEG_NOT_FOUND }
  revalidateBooking(bookingId)
  return { success: true }
}

export async function deleteTravelLeg(bookingId: string, legId: string): Promise<TravelActionResult> {
  if (!travelRecordIdSchema.safeParse(bookingId).success || !travelRecordIdSchema.safeParse(legId).success) {
    return { success: false, error: LEG_NOT_FOUND }
  }
  const scope = await scopedClient()
  if (!scope) return { success: false, error: "Not authenticated" }
  const { data, error } = await scope.supabase.from("booking_travel_legs")
    .delete()
    .eq("id", legId).eq("booking_id", bookingId).eq("workspace_id", scope.workspaceId)
    .select("id").maybeSingle()
  if (error) {
    logFailure("Error deleting travel leg:", error)
    return { success: false, error: LEG_DELETE_FAILED }
  }
  if (!data) return { success: false, error: LEG_NOT_FOUND }
  revalidateBooking(bookingId)
  return { success: true }
}

export async function createBookingStay(bookingId: string, input: BookingStayInput): Promise<TravelActionResult> {
  if (!travelRecordIdSchema.safeParse(bookingId).success) return { success: false, error: "Invalid booking ID" }
  const parsed = bookingStaySchema.safeParse(input)
  if (!parsed.success) return { success: false, error: firstIssue(parsed.error) }
  const scope = await scopedClient()
  if (!scope) return { success: false, error: "Not authenticated" }
  const { data, error } = await scope.supabase.from("booking_stays")
    .insert({ ...parsed.data, workspace_id: scope.workspaceId, booking_id: bookingId })
    .select("id").maybeSingle()
  if (error) {
    logFailure("Error creating stay:", error)
    return { success: false, error: writeErrorMessage(error, STAY_SAVE_FAILED) }
  }
  if (!data) return { success: false, error: STAY_SAVE_FAILED }
  revalidateBooking(bookingId)
  return { success: true }
}

export async function updateBookingStay(bookingId: string, stayId: string, input: BookingStayInput): Promise<TravelActionResult> {
  if (!travelRecordIdSchema.safeParse(bookingId).success || !travelRecordIdSchema.safeParse(stayId).success) {
    return { success: false, error: STAY_NOT_FOUND }
  }
  const parsed = bookingStaySchema.safeParse(input)
  if (!parsed.success) return { success: false, error: firstIssue(parsed.error) }
  const scope = await scopedClient()
  if (!scope) return { success: false, error: "Not authenticated" }
  const { data, error } = await scope.supabase.from("booking_stays")
    .update({ ...parsed.data, updated_at: new Date().toISOString() })
    .eq("id", stayId).eq("booking_id", bookingId).eq("workspace_id", scope.workspaceId)
    .select("id").maybeSingle()
  if (error) {
    logFailure("Error updating stay:", error)
    return { success: false, error: writeErrorMessage(error, STAY_SAVE_FAILED) }
  }
  if (!data) return { success: false, error: STAY_NOT_FOUND }
  revalidateBooking(bookingId)
  return { success: true }
}

export async function deleteBookingStay(bookingId: string, stayId: string): Promise<TravelActionResult> {
  if (!travelRecordIdSchema.safeParse(bookingId).success || !travelRecordIdSchema.safeParse(stayId).success) {
    return { success: false, error: STAY_NOT_FOUND }
  }
  const scope = await scopedClient()
  if (!scope) return { success: false, error: "Not authenticated" }
  const { data, error } = await scope.supabase.from("booking_stays")
    .delete()
    .eq("id", stayId).eq("booking_id", bookingId).eq("workspace_id", scope.workspaceId)
    .select("id").maybeSingle()
  if (error) {
    logFailure("Error deleting stay:", error)
    return { success: false, error: STAY_DELETE_FAILED }
  }
  if (!data) return { success: false, error: STAY_NOT_FOUND }
  revalidateBooking(bookingId)
  return { success: true }
}

/** Sets or clears (null or "") who organizes and pays transport to the city. Writes only that column. */
export async function updateBookingTransportToCity(bookingId: string, value: string | null): Promise<TravelActionResult> {
  if (!travelRecordIdSchema.safeParse(bookingId).success) return { success: false, error: BOOKING_NOT_FOUND }
  const parsed = transportToCitySchema.safeParse(value)
  if (!parsed.success) return { success: false, error: firstIssue(parsed.error) }
  const scope = await scopedClient()
  if (!scope) return { success: false, error: "Not authenticated" }
  const { data, error } = await scope.supabase.from("bookings")
    .update({ transport_to_city: parsed.data })
    .eq("id", bookingId).eq("workspace_id", scope.workspaceId)
    .select("id").maybeSingle()
  if (error) {
    logFailure("Error updating transport to the city:", error)
    return { success: false, error: error.code === "23514" ? REJECTED_BY_DATABASE : TRANSPORT_SAVE_FAILED }
  }
  if (!data) return { success: false, error: BOOKING_NOT_FOUND }
  revalidateBooking(bookingId)
  return { success: true }
}
