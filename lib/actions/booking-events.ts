"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { BOOKING_EVENT_COPY, EVENT_BOOKING_STATUS_SQLSTATE, bookingEventTitle, canConvertBookingToEvent } from "@/lib/booking-event"
import { getCurrentWorkspaceId } from "./workspace"

export type BookingEventLink = { id: string; title: string }

/**
 * existing: true = the booking already had this event (retry, double click, lost response):
 * the caller opens it. Only a verified link is ever returned as existing.
 */
export type BookingEventResult =
  | { success: true; eventId: string; existing: boolean }
  | { success: false; error: string }

// Explicit projections only: never `*`, never public_token.
const BOOKING_SOURCE_FIELDS =
  "id,status,date,start_time,venue_name,artist_id,promoter_id,fee_amount_minor,fee_currency,artist:artists(stage_name,name)"

type BookingSource = {
  id: string
  status: string
  date: string
  start_time: string | null
  venue_name: string | null
  artist_id: string
  promoter_id: string | null
  fee_amount_minor: number | null
  fee_currency: string | null
  artist: { stage_name: string | null; name: string | null } | null
}

type Client = Awaited<ReturnType<typeof createClient>>

async function readLinkedEvent(supabase: Client, workspaceId: string, bookingId: string) {
  const { data, error } = await supabase
    .from("events")
    .select("id,title")
    .eq("workspace_id", workspaceId)
    .eq("booking_id", bookingId)
    .maybeSingle()
  const row = data as BookingEventLink | null
  const link = row && z.guid().safeParse(row.id).success ? { id: row.id, title: row.title } : null
  return { link, error }
}

/** The event created from this booking, or null. A failed read throws; it is never "no event". */
export async function getBookingEventLink(bookingId: string): Promise<BookingEventLink | null> {
  if (!z.guid().safeParse(bookingId).success) return null
  const supabase = await createClient()
  const workspaceId = await getCurrentWorkspaceId()
  const { link, error } = await readLinkedEvent(supabase, workspaceId, bookingId)
  if (error) throw new Error("Unable to load the linked event.")
  return link
}

/**
 * Creates the event of a confirmed or completed booking: one INSERT, the booking is not
 * changed. events.booking_id is UNIQUE, so a retry or a concurrent request cannot create a
 * second event; it gets the existing event back (existing: true) once that link is verified.
 */
export async function createEventFromBooking(bookingId: string): Promise<BookingEventResult> {
  if (!z.guid().safeParse(bookingId).success) return { success: false, error: BOOKING_EVENT_COPY.notFound }

  const supabase = await createClient()
  const workspaceId = await getCurrentWorkspaceId()

  const { data: bookingRow, error: bookingError } = await supabase
    .from("bookings")
    .select(BOOKING_SOURCE_FIELDS)
    .eq("workspace_id", workspaceId)
    .eq("id", bookingId)
    .maybeSingle()
  if (bookingError) {
    console.error("Error reading the booking to convert:", bookingError)
    return { success: false, error: BOOKING_EVENT_COPY.failed }
  }
  const booking = bookingRow as unknown as BookingSource | null
  if (!booking || booking.id !== bookingId) return { success: false, error: BOOKING_EVENT_COPY.notFound }

  const existing = await readLinkedEvent(supabase, workspaceId, bookingId)
  if (existing.error) {
    console.error("Error checking the event of a booking:", existing.error)
    return { success: false, error: BOOKING_EVENT_COPY.failed }
  }
  // A second attempt reopens the event already linked, whatever the booking status now is
  // (a converted booking may since have been cancelled, together with its event).
  if (existing.link) return { success: true, eventId: existing.link.id, existing: true }
  if (!canConvertBookingToEvent(booking.status)) return { success: false, error: BOOKING_EVENT_COPY.notConvertible }

  const venue = booking.venue_name?.trim() || null
  const hasFee = booking.fee_amount_minor !== null && booking.fee_currency !== null
  const { data: created, error: insertError } = await supabase
    .from("events")
    .insert({
      workspace_id: workspaceId,
      booking_id: booking.id,
      title: bookingEventTitle(booking.artist, venue),
      date: booking.date,
      location: venue,
      status: "confirmed",
      artist_id: booking.artist_id,
      promoter_id: booking.promoter_id ?? null,
      start_time: booking.start_time ?? null,
      // Snapshot: later fee edits on the booking do not change the event.
      fee_amount_minor: hasFee ? booking.fee_amount_minor : null,
      fee_currency: hasFee ? booking.fee_currency : null,
    })
    .select("id,workspace_id,booking_id")
    .maybeSingle()

  if (insertError) {
    console.error("Error creating the event of a booking:", insertError)
    if (insertError.code === "23505") {
      // Lost a race against another request for the same booking: open its event, but only
      // once the link is read back; otherwise the outcome is unconfirmed, never "already exists".
      const winner = await readLinkedEvent(supabase, workspaceId, bookingId)
      if (winner.error) console.error("Error reading the event of a booking after a race:", winner.error)
      return winner.link
        ? { success: true, eventId: winner.link.id, existing: true }
        : { success: false, error: BOOKING_EVENT_COPY.unconfirmed }
    }
    // The database gate: the booking left confirmed/completed after the read above.
    if (insertError.code === EVENT_BOOKING_STATUS_SQLSTATE) return { success: false, error: BOOKING_EVENT_COPY.notConvertible }
    // 23503: the booking, its artist or its promoter was deleted after the read above.
    if (insertError.code === "23503") return { success: false, error: BOOKING_EVENT_COPY.changed }
    return { success: false, error: BOOKING_EVENT_COPY.failed }
  }
  // No provider error is not proof of a write: require the created row back, in the
  // authoritative workspace and linked to this booking.
  const witness = created as { id?: unknown; workspace_id?: unknown; booking_id?: unknown } | null
  const createdId = witness?.id
  if (typeof createdId !== "string" || !z.guid().safeParse(createdId).success
    || witness?.workspace_id !== workspaceId || witness?.booking_id !== bookingId) {
    return { success: false, error: BOOKING_EVENT_COPY.unconfirmed }
  }

  revalidatePath("/dashboard/events")
  revalidatePath(`/dashboard/events/${createdId}`)
  revalidatePath(`/dashboard/bookings/${bookingId}`)
  revalidatePath("/dashboard")
  revalidatePath("/dashboard/artists")
  return { success: true, eventId: createdId, existing: false }
}
