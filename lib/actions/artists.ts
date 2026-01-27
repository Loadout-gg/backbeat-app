"use server"

import { createClient } from "@/lib/supabase/server"
import { getCurrentWorkspaceId } from "./workspace"
import { revalidatePath } from "next/cache"

export type SocialLink = {
  type: string
  url: string
}

export type Artist = {
  id: string
  name: string
  email: string | null
  phone: string | null
  notes: string | null
  workspace_id: string
  created_at: string
  // New fields
  stage_name: string | null
  surname: string | null
  location: string | null
  genres: string[]
  fee: number | null
  currency: string | null
  travel_fee: string | null
  pricing_notes: string | null
  social_links: SocialLink[]
  overview: string | null
  dj_equipment: string | null
  sound_system: string | null
  allergies: string | null
  special_diet: string | null
  special_needs: string | null
  documents: { name: string; url: string }[]
  updated_at: string | null
}

export type CreateArtistInput = {
  // General info (Step 1)
  stage_name: string
  name?: string
  surname?: string
  location?: string
  contact_name?: string
  phone?: string
  email?: string
  fee?: number
  currency?: string
  travel_fee?: string
  pricing_notes?: string
  social_links?: SocialLink[]
  // Artist overview (Step 2)
  overview?: string
  genres?: string[]
  dj_equipment?: string
  sound_system?: string
  // Documents (Step 3) - stored as metadata only for now
  documents?: { name: string; url: string }[]
  // Special requirements (Step 4)
  allergies?: string
  special_diet?: string
  special_needs?: string
  notes?: string
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

  return (data ?? []).map((artist) => ({
    ...artist,
    genres: artist.genres ?? [],
    social_links: artist.social_links ?? [],
    documents: artist.documents ?? [],
  }))
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

  return {
    ...data,
    genres: data.genres ?? [],
    social_links: data.social_links ?? [],
    documents: data.documents ?? [],
  }
}

export async function createArtist(
  input: CreateArtistInput,
): Promise<{ success: boolean; artistId?: string; error?: string }> {
  const supabase = await createClient()
  const workspaceId = await getCurrentWorkspaceId()

  const { data, error } = await supabase
    .from("artists")
    .insert({
      workspace_id: workspaceId,
      // Use stage_name as the primary name field
      name: input.stage_name,
      stage_name: input.stage_name,
      surname: input.surname || null,
      location: input.location || null,
      // Contact info - use contact_name for notes if provided
      email: input.email || null,
      phone: input.phone || null,
      notes: input.contact_name ? `Contact: ${input.contact_name}` : input.notes || null,
      // Pricing
      fee: input.fee || null,
      currency: input.currency || "USD",
      travel_fee: input.travel_fee || null,
      pricing_notes: input.pricing_notes || null,
      social_links: input.social_links || [],
      // Artist overview
      overview: input.overview || null,
      genres: input.genres || [],
      dj_equipment: input.dj_equipment || null,
      sound_system: input.sound_system || null,
      // Documents
      documents: input.documents || [],
      // Special requirements
      allergies: input.allergies || null,
      special_diet: input.special_diet || null,
      special_needs: input.special_needs || null,
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

export type UpdateArtistInput = Partial<CreateArtistInput>

export async function updateArtist(
  id: string,
  input: UpdateArtistInput,
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient()
  const workspaceId = await getCurrentWorkspaceId()

  // First verify the artist belongs to this workspace
  const { data: existing } = await supabase
    .from("artists")
    .select("id")
    .eq("id", id)
    .eq("workspace_id", workspaceId)
    .single()

  if (!existing) {
    return { success: false, error: "Artist not found" }
  }

  const updateData: Record<string, unknown> = {}

  // Only include fields that are explicitly provided
  if (input.stage_name !== undefined) {
    updateData.stage_name = input.stage_name
    updateData.name = input.stage_name // Keep name in sync with stage_name
  }
  if (input.name !== undefined) updateData.name = input.name
  if (input.surname !== undefined) updateData.surname = input.surname || null
  if (input.location !== undefined) updateData.location = input.location || null
  if (input.email !== undefined) updateData.email = input.email || null
  if (input.phone !== undefined) updateData.phone = input.phone || null
  if (input.contact_name !== undefined) {
    updateData.notes = input.contact_name ? `Contact: ${input.contact_name}` : null
  }
  if (input.fee !== undefined) updateData.fee = input.fee || null
  if (input.currency !== undefined) updateData.currency = input.currency || "USD"
  if (input.travel_fee !== undefined) updateData.travel_fee = input.travel_fee || null
  if (input.pricing_notes !== undefined) updateData.pricing_notes = input.pricing_notes || null
  if (input.social_links !== undefined) updateData.social_links = input.social_links || []
  if (input.overview !== undefined) updateData.overview = input.overview || null
  if (input.genres !== undefined) updateData.genres = input.genres || []
  if (input.dj_equipment !== undefined) updateData.dj_equipment = input.dj_equipment || null
  if (input.sound_system !== undefined) updateData.sound_system = input.sound_system || null
  if (input.documents !== undefined) updateData.documents = input.documents || []
  if (input.allergies !== undefined) updateData.allergies = input.allergies || null
  if (input.special_diet !== undefined) updateData.special_diet = input.special_diet || null
  if (input.special_needs !== undefined) updateData.special_needs = input.special_needs || null

  const { error } = await supabase
    .from("artists")
    .update(updateData)
    .eq("id", id)
    .eq("workspace_id", workspaceId)

  if (error) {
    return { success: false, error: error.message }
  }

  revalidatePath("/dashboard/artists")
  revalidatePath(`/dashboard/artists/${id}`)
  revalidatePath("/dashboard")

  return { success: true }
}
