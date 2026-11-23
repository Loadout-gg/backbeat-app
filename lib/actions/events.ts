"use server"

import { readCompleteCollection } from "@/lib/read-complete-collection"

import { createClient } from "@/lib/supabase/server"
import { getCurrentWorkspaceId } from "./workspace"
import { revalidatePath } from "next/cache"
import { z } from "zod"

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

export type EventDetail = Pick<Event, "id" | "title" | "date" | "location" | "status" | "artist_id" | "promoter_id">

export type EventUpdateInput = {
  title: string
  date: string
  location?: string | null
  status: "in_progress" | "confirmed" | "cancelled"
  artist_id?: string | null
  promoter_id?: string | null
}

const EVENT_SAVE_FAILED = "Unable to save the event. Please try again."
const EVENT_NOT_FOUND = "Event not found."

// Same field rules as creation; on update every field is stated, and null clears a link.
const updateEventSchema = z.object({
  title: createEventSchema.shape.title,
  date: createEventSchema.shape.date,
  location: z.string().trim().nullish().transform(value => value || null),
  status: z.enum(["in_progress", "confirmed", "cancelled"], "Choose a valid status"),
  artist_id: z.guid("Choose a valid artist").nullish().transform(value => value ?? null),
  promoter_id: z.guid("Choose a valid promoter").nullish().transform(value => value ?? null),
})

/** Null means "no such event in this workspace"; a failed read throws. */
export async function getEvent(id: string): Promise<EventDetail | null> {
  if (!z.guid().safeParse(id).success) return null
  const supabase = await createClient()
  const workspaceId = await getCurrentWorkspaceId()
  const { data, error } = await supabase
    .from("events")
    .select("id,title,date,location,status,artist_id,promoter_id")
    .eq("workspace_id", workspaceId)
    .eq("id", id)
    .maybeSingle()
  if (error) throw new Error("Unable to load the event.")
  if (!data) return null
  const row = data as EventDetail
  return {
    id: row.id, title: row.title, date: row.date, location: row.location,
    status: row.status, artist_id: row.artist_id, promoter_id: row.promoter_id,
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
  const { data, error } = await supabase
    .from("events")
    .update(validation.data)
    .eq("workspace_id", workspaceId)
    .eq("id", id)
    .select("id")

  // The provider message is never shown to the user.
  if (error) return { success: false, error: EVENT_SAVE_FAILED }
  // No provider error is not proof of a write: require exactly the targeted row back.
  if (!Array.isArray(data) || data.length !== 1 || data[0].id !== id) return { success: false, error: EVENT_NOT_FOUND }

  revalidatePath("/dashboard/events")
  revalidatePath(`/dashboard/events/${id}`)
  revalidatePath("/dashboard")
  revalidatePath("/dashboard/artists")
  return { success: true }
}

const EVENT_DELETE_FAILED = "Unable to delete the event. Please try again."

/** Deletes one event of the selected workspace. Bookings, artists and promoters are separate records and are not touched. */
export async function deleteEvent(id: string): Promise<{ success: true } | { success: false; error: string }> {
  if (!z.guid().safeParse(id).success) return { success: false, error: EVENT_NOT_FOUND }

  const supabase = await createClient()
  const workspaceId = await getCurrentWorkspaceId()
  const { data, error } = await supabase
    .from("events")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("id", id)
    .select("id")

  if (error) return { success: false, error: EVENT_DELETE_FAILED }
  // No provider error is not proof of a delete: require exactly the targeted row back.
  if (!Array.isArray(data) || data.length !== 1 || data[0].id !== id) return { success: false, error: EVENT_NOT_FOUND }

  revalidatePath("/dashboard/events")
  revalidatePath("/dashboard")
  revalidatePath("/dashboard/artists")
  return { success: true }
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
