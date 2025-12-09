"use server"

import { createClient } from "@/lib/supabase/server"
import { getCurrentWorkspaceId } from "./workspace"
import { revalidatePath } from "next/cache"

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

export async function listEvents(): Promise<EventWithRelations[]> {
  const supabase = await createClient()
  const workspaceId = await getCurrentWorkspaceId()

  const { data, error } = await supabase
    .from("events")
    .select(`
      *,
      artists:artist_id (id, name),
      promoters:promoter_id (id, name, company_name)
    `)
    .eq("workspace_id", workspaceId)
    .order("date", { ascending: false })
    .order("created_at", { ascending: false })

  if (error) {
    throw new Error(error.message)
  }

  return (data ?? []) as EventWithRelations[]
}

export async function listEventsInProgress(): Promise<EventWithRelations[]> {
  const supabase = await createClient()
  const workspaceId = await getCurrentWorkspaceId()

  const { data, error } = await supabase
    .from("events")
    .select(`
      *,
      artists:artist_id (id, name),
      promoters:promoter_id (id, name, company_name)
    `)
    .eq("workspace_id", workspaceId)
    .eq("status", "in_progress")
    .order("date", { ascending: true })
    .order("created_at", { ascending: false })

  if (error) {
    throw new Error(error.message)
  }

  return (data ?? []) as EventWithRelations[]
}

export async function createEvent(input: {
  title: string
  date: string
  location?: string
  status?: "in_progress" | "confirmed" | "cancelled"
  artist_id?: string
  promoter_id?: string
}): Promise<{ success: boolean; eventId?: string; error?: string }> {
  const supabase = await createClient()
  const workspaceId = await getCurrentWorkspaceId()

  const { data, error } = await supabase
    .from("events")
    .insert({
      title: input.title,
      date: input.date,
      location: input.location || null,
      status: input.status || "in_progress",
      artist_id: input.artist_id || null,
      promoter_id: input.promoter_id || null,
      workspace_id: workspaceId,
    })
    .select("id")
    .single()

  if (error) {
    return { success: false, error: error.message }
  }

  revalidatePath("/dashboard/events")
  revalidatePath("/dashboard")

  return { success: true, eventId: data.id }
}

export async function listPromoters(): Promise<Promoter[]> {
  const supabase = await createClient()
  const workspaceId = await getCurrentWorkspaceId()

  const { data, error } = await supabase
    .from("promoters")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("name", { ascending: true })

  if (error) {
    throw new Error(error.message)
  }

  return data ?? []
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
