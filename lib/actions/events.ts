"use server"

import { readCompleteCollection } from "@/lib/read-complete-collection"

import { createClient } from "@/lib/supabase/server"
import { getCurrentWorkspaceId } from "./workspace"
import { revalidatePath } from "next/cache"
import { z } from "zod"
import { BOOKING_EVENT_COPY, bookingEventErrorCopy } from "@/lib/booking-event"
import { bookingFeeShape, type BookingFeeCurrency } from "@/lib/booking-fee"

// Types derived from Supabase schema
export type Event = {
  id: string
  title: string
  date: string
  location: string | null
  status: string
  artist_id: string | null
  promoter_id: string | null
  workspace_id: string
  created_at: string
}

export type Promoter = {
  id: string
  name: string
  company_name: string | null
  email: string | null
  phone: string | null
  notes: string | null
  workspace_id: string
  created_at: string
}

// List rows carry only what the events list, dashboard and artist profile render.
// public_token, workspace_id and created_at never leave the server through list reads.
const EVENT_LIST_COLUMNS = "id,title,date,location,status,artist_id"
const EVENT_LIST_SELECT = `${EVENT_LIST_COLUMNS},artists:artist_id(id,name,stage_name),promoters:promoter_id(id,name,company_name)`

export type EventListRow = Pick<Event, "id" | "title" | "date" | "location" | "status" | "artist_id">

export type EventWithRelations = EventListRow & {
  artists: { id: string; name: string; stage_name: string | null } | null
  promoters: { id: string; name: string; company_name: string | null } | null
}

export async function listEvents(
  options: { artistId?: string } = {},
): Promise<EventWithRelations[]> {
  if (
    options.artistId !== undefined &&
    !z.guid().safeParse(options.artistId).success
  ) {
    throw new Error("Invalid artist ID")
  }

  const supabase = await createClient()
  const workspaceId = await getCurrentWorkspaceId()

  return readCompleteCollection<EventWithRelations>(async (from, to) => {
    let query = supabase
      .from("events")
      .select(EVENT_LIST_SELECT, { count: "exact" })
      .eq("workspace_id", workspaceId)

    if (options.artistId !== undefined) {
      query = query.eq("artist_id", options.artistId)
    }

    const { data, error, count } = await query
      .order("date", { ascending: false })
      .order("created_at", { ascending: false })
      .order("id", { ascending: true })
      .range(from, to)

    return {
      data: data as unknown as EventWithRelations[] | null,
      error,
      count,
    }
  }, "Events")
}

export async function listEventsInProgress(): Promise<EventWithRelations[]> {
  const supabase = await createClient()
  const workspaceId = await getCurrentWorkspaceId()

  return readCompleteCollection<EventWithRelations>(async (from, to) => {
    const { data, error, count } = await supabase
      .from("events")
      .select(EVENT_LIST_SELECT, { count: "exact" })
      .eq("workspace_id", workspaceId)
      .eq("status", "in_progress")
      .order("date", { ascending: true })
      .order("created_at", { ascending: false })
      .order("id", { ascending: true })
      .range(from, to)

    return {
      data: data as unknown as EventWithRelations[] | null,
      error,
      count,
    }
  }, "Events in progress")
}

const createEventSchema = z.object({
  title: z.string()
    .trim()
    .min(1, "Event title is required"),
  date: z.string()
    .date("Enter a valid event date")
    .refine(
      value => !value.startsWith("0000-"),
      "Enter a valid event date",
    ),
  location: z.string()
    .trim()
    .optional(),
  status: z.enum(["in_progress", "confirmed", "cancelled"])
    .default("in_progress"),
  artist_id: z.guid("Choose a valid artist").optional(),
  promoter_id: z.guid("Choose a valid promoter").optional(),
})

export async function createEvent(input: {
  title: string
  date: string
  location?: string
  status?: "in_progress" | "confirmed" | "cancelled"
  artist_id?: string
  promoter_id?: string
}): Promise<{ success: boolean; eventId?: string; error?: string }> {
  const validation = createEventSchema.safeParse(input)
  if (!validation.success) {
    return { success: false, error: validation.error.issues[0].message }
  }

  const value = validation.data
  const supabase = await createClient()
  const workspaceId = await getCurrentWorkspaceId()

  const { data, error } = await supabase
    .from("events")
    .insert({
      title: value.title,
      date: value.date,
      location: value.location || null,
      status: value.status,
      artist_id: value.artist_id ?? null,
      promoter_id: value.promoter_id ?? null,
      workspace_id: workspaceId,
    })
    .select("id")
    .single()

  if (error) return { success: false, error: error.message }
  if (!data || !z.guid().safeParse(data.id).success) {
    return { success: false, error: "Unable to create event. Please try again." }
  }

  revalidatePath("/dashboard/events")
  revalidatePath("/dashboard")

  return { success: true, eventId: data.id }
}

export type EventDetail = Pick<Event, "id" | "title" | "date" | "location" | "status" | "artist_id" | "promoter_id"> & {
  /** The booking this event was created from; null for events created directly or after that booking was deleted. */
  booking_id: string | null
  start_time: string | null
  /** Snapshot taken at conversion, then edited only here. Same pair rule as the booking fee. */
  fee_amount_minor: number | null
  fee_currency: BookingFeeCurrency | null
}

export type EventUpdateInput = {
  title: string
  date: string
  location?: string | null
  status: "in_progress" | "confirmed" | "cancelled"
  artist_id?: string | null
  promoter_id?: string | null
  /** Omitted = unchanged, null = cleared. */
  start_time?: string | null
  /** Both omitted = unchanged, both null = cleared; an incomplete pair is rejected. */
  fee_amount_minor?: number | null
  fee_currency?: string | null
}

const EVENT_SAVE_FAILED = "Unable to save the event. Please try again."
const EVENT_NOT_FOUND = "Event not found."

const EVENT_DETAIL_FIELDS = "id,title,date,location,status,artist_id,promoter_id,booking_id,start_time,fee_amount_minor,fee_currency"

// Same field rules as creation; on update every field is stated, and null clears a link.
// start_time and the fee pair (migration 008) are optional: omitted stays unchanged.
// booking_id is not writable here: the link is created only by createEventFromBooking.
const updateEventSchema = z.object({
  ...bookingFeeShape,
  start_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, "Enter a valid start time").nullable().optional(),
  title: createEventSchema.shape.title,
  date: createEventSchema.shape.date,
  location: z.string().trim().nullish().transform(value => value || null),
  status: z.enum(["in_progress", "confirmed", "cancelled"], "Choose a valid status"),
  artist_id: z.guid("Choose a valid artist").nullish().transform(value => value ?? null),
  promoter_id: z.guid("Choose a valid promoter").nullish().transform(value => value ?? null),
}).superRefine((value, context) => {
  if (value.fee_amount_minor === undefined && value.fee_currency === undefined) return
  if (value.fee_amount_minor === null && value.fee_currency === null) return
  if (typeof value.fee_amount_minor === "number" && value.fee_currency != null) return
  context.addIssue({ code: "custom", path: ["fee_amount_minor"], message: "Enter both fee amount and currency, or clear both" })
})

/** Null means "no such event in this workspace"; a failed read throws. */
export async function getEvent(id: string): Promise<EventDetail | null> {
  if (!z.guid().safeParse(id).success) return null
  const supabase = await createClient()
  const workspaceId = await getCurrentWorkspaceId()
  const { data, error } = await supabase
    .from("events")
    .select(EVENT_DETAIL_FIELDS)
    .eq("workspace_id", workspaceId)
    .eq("id", id)
    .maybeSingle()
  if (error) throw new Error("Unable to load the event.")
  if (!data) return null
  const row = data as unknown as EventDetail
  return {
    id: row.id, title: row.title, date: row.date, location: row.location,
    status: row.status, artist_id: row.artist_id, promoter_id: row.promoter_id,
    booking_id: row.booking_id ?? null, start_time: row.start_time ?? null,
    fee_amount_minor: row.fee_amount_minor ?? null, fee_currency: row.fee_currency ?? null,
  }
}

export async function updateEvent(
  id: string,
  input: EventUpdateInput,
): Promise<{ success: true } | { success: false; error: string }> {
  if (!z.guid().safeParse(id).success) return { success: false, error: EVENT_NOT_FOUND }
  const validation = updateEventSchema.safeParse(input)
  if (!validation.success) return { success: false, error: validation.error.issues[0].message }

  const supabase = await createClient()
  const workspaceId = await getCurrentWorkspaceId()
  // Omitted optional fields are left out of the write, so they stay unchanged.
  const patch = Object.fromEntries(Object.entries(validation.data).filter(([, value]) => value !== undefined))
  const { data, error } = await supabase
    .from("events")
    .update(patch)
    .eq("workspace_id", workspaceId)
    .eq("id", id)
    .select("id")

  // The provider message is never shown to the user.
  // BB008–BB011 (migration 008 triggers) are answered with their fixed copy.
  if (error) return { success: false, error: bookingEventErrorCopy(error) ?? EVENT_SAVE_FAILED }
  // No provider error is not proof of a write: require exactly the targeted row back.
  if (!Array.isArray(data) || data.length !== 1 || data[0].id !== id) return { success: false, error: EVENT_NOT_FOUND }

  revalidatePath("/dashboard/events")
  revalidatePath(`/dashboard/events/${id}`)
  revalidatePath("/dashboard")
  revalidatePath("/dashboard/artists")
  return { success: true }
}

const EVENT_DELETE_FAILED = "Unable to delete the event. Please try again."

/**
 * Deletes one event of the selected workspace that was not created from a booking.
 * An event with booking_id follows its booking (cancelled with it, kept as history) and is
 * never deleted here: the delete itself is filtered on booking_id IS NULL, so a link cannot
 * slip in between a check and the write. Bookings, artists and promoters are not touched.
 * A database-level guard is pending Alberto's decision (BACKLOG).
 */
export async function deleteEvent(id: string): Promise<{ success: true } | { success: false; error: string }> {
  if (!z.guid().safeParse(id).success) return { success: false, error: EVENT_NOT_FOUND }

  const supabase = await createClient()
  const workspaceId = await getCurrentWorkspaceId()
  const { data, error } = await supabase
    .from("events")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("id", id)
    .is("booking_id", null)
    .select("id")

  if (error) return { success: false, error: bookingEventErrorCopy(error) ?? EVENT_DELETE_FAILED }
  if (Array.isArray(data) && data.length === 0) {
    // Nothing deleted: tell a booking-linked event apart from a missing one.
    const { data: row, error: readError } = await supabase
      .from("events")
      .select("id,booking_id")
      .eq("workspace_id", workspaceId)
      .eq("id", id)
      .maybeSingle()
    if (readError) return { success: false, error: EVENT_DELETE_FAILED }
    const linked = row as { id?: string; booking_id?: string | null } | null
    if (linked?.id === id && linked.booking_id) return { success: false, error: BOOKING_EVENT_COPY.eventFromBookingDelete }
    return { success: false, error: EVENT_NOT_FOUND }
  }
  // No provider error is not proof of a delete: require exactly the targeted row back.
  if (!Array.isArray(data) || data.length !== 1 || data[0].id !== id) return { success: false, error: EVENT_NOT_FOUND }

  revalidatePath("/dashboard/events")
  revalidatePath("/dashboard")
  revalidatePath("/dashboard/artists")
  return { success: true }
}

/**
 * Stored status of the booking an event was created from, so the event page can show the
 * status control read-only while that booking is cancelled. Null: no such booking in the
 * selected workspace. A failed read throws; the page then leaves the control editable and
 * the database decides (BB010).
 */
export async function getEventBookingStatus(bookingId: string): Promise<string | null> {
  if (!z.guid().safeParse(bookingId).success) return null
  const supabase = await createClient()
  const workspaceId = await getCurrentWorkspaceId()
  const { data, error } = await supabase
    .from("bookings")
    .select("id,status")
    .eq("workspace_id", workspaceId)
    .eq("id", bookingId)
    .maybeSingle()
  if (error) throw new Error("Unable to load the booking of this event.")
  const row = data as { id?: string; status?: unknown } | null
  if (!row || row.id !== bookingId || typeof row.status !== "string") return null
  return row.status
}

export type PromoterOption = Pick<Promoter, "id" | "name" | "company_name">

// Used by the event selector; never send contacts/notes. The directory and writes live in ./promoters.
export async function listPromoters(): Promise<PromoterOption[]> {
  const supabase = await createClient()
  const workspaceId = await getCurrentWorkspaceId()
  const rows = await readCompleteCollection<PromoterOption>(async (from, to) => {
    const { data, error, count } = await supabase
      .from("promoters")
      .select("id,name,company_name", { count: "exact" })
      .eq("workspace_id", workspaceId)
      .order("name", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to)
    return { data: data as PromoterOption[] | null, error, count }
  }, "Promoter options")
  return rows.map(row => ({ id: row.id, name: row.name, company_name: row.company_name }))
}
