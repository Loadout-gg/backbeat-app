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

export type EventWithRelations = Event & {
  artists: { id: string; name: string } | null
  promoters: { id: string; name: string; company_name: string | null } | null
}

export async function listEvents(
  options: { artistId?: string } = {},
): Promise<EventWithRelations[]> {
  if (
    options.artistId !== undefined &&
    !z.string().uuid().safeParse(options.artistId).success
  ) {
    throw new Error("Invalid artist ID")
  }

  const supabase = await createClient()
  const workspaceId = await getCurrentWorkspaceId()

  return readCompleteCollection<EventWithRelations>(async (from, to) => {
    let query = supabase
      .from("events")
      .select(`
        *,
        artists:artist_id (id, name),
        promoters:promoter_id (id, name, company_name)
      `, { count: "exact" })
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
      .select(`
        *,
        artists:artist_id (id, name),
        promoters:promoter_id (id, name, company_name)
      `, { count: "exact" })
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
  artist_id: z.string().uuid("Choose a valid artist").optional(),
  promoter_id: z.string().uuid("Choose a valid promoter").optional(),
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
  if (!data || !z.string().uuid().safeParse(data.id).success) {
    return { success: false, error: "Unable to create event. Please try again." }
  }

  revalidatePath("/dashboard/events")
  revalidatePath("/dashboard")

  return { success: true, eventId: data.id }
}

export type PromoterOption = Pick<Promoter, "id" | "name" | "company_name">

// The sole production caller is the event selector; never send contacts/notes.
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

export async function createPromoter(input: {
  name: string
  company_name?: string
  email?: string
  phone?: string
  notes?: string
}): Promise<{ success: boolean; promoterId?: string; error?: string }> {
  const supabase = await createClient()
  const workspaceId = await getCurrentWorkspaceId()

  const { data, error } = await supabase
    .from("promoters")
    .insert({
      name: input.name,
      company_name: input.company_name || null,
      email: input.email || null,
      phone: input.phone || null,
      notes: input.notes || null,
      workspace_id: workspaceId,
    })
    .select("id")
    .single()

  if (error) {
    return { success: false, error: error.message }
  }

  revalidatePath("/dashboard/events/new")

  return { success: true, promoterId: data.id }
}
