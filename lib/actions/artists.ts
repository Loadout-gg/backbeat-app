"use server"

import { createClient } from "@/lib/supabase/server"
import { getCurrentWorkspaceId } from "./workspace"
import { revalidatePath } from "next/cache"

// Types derived from Supabase schema
export type Artist = {
  id: string
  name: string
  email: string | null
  phone: string | null
  notes: string | null
  workspace_id: string
  created_at: string
}

export async function listArtists(): Promise<Artist[]> {
  const supabase = await createClient()
  const workspaceId = await getCurrentWorkspaceId()

  const { data, error } = await supabase
    .from("artists")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("name", { ascending: true })

  if (error) {
    throw new Error(error.message)
  }

  return data ?? []
}

export async function getArtist(id: string): Promise<Artist | null> {
  const supabase = await createClient()
  const workspaceId = await getCurrentWorkspaceId()

  const { data, error } = await supabase
    .from("artists")
    .select("*")
    .eq("id", id)
    .eq("workspace_id", workspaceId)
    .single()

  if (error) {
    return null
  }

  return data
}

export async function createArtist(input: {
  name: string
  email?: string
  phone?: string
  notes?: string
}): Promise<{ success: boolean; artistId?: string; error?: string }> {
  const supabase = await createClient()
  const workspaceId = await getCurrentWorkspaceId()

  const { data, error } = await supabase
    .from("artists")
    .insert({
      name: input.name,
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

  revalidatePath("/dashboard/artists")
  revalidatePath("/dashboard")

  return { success: true, artistId: data.id }
}
