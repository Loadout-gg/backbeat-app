"use server"

import { readCompleteCollection } from "@/lib/read-complete-collection"

import { createClient } from "@/lib/supabase/server"
import { getCurrentWorkspaceId } from "./workspace"
import { revalidatePath } from "next/cache"
import {
  createArtistSchema,
  updateArtistSchema,
  withArtistContact,
  type CreateArtistInput,
  type UpdateArtistInput,
  type SocialLink,
} from "@/lib/artist-validation"

export type {
  CreateArtistInput,
  UpdateArtistInput,
  SocialLink,
} from "@/lib/artist-validation"

export type Artist = {
  id: string
  name: string
  email: string | null
  phone: string | null
  notes: string | null
  workspace_id: string
  created_at: string
  // New fields
  stage_name: string
  real_name: string | null
  surname: string | null
  location: string | null
  genre: string | null
  genres: string[]
  fee: number | null
  base_rate: number | null
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
  profile_image_url: string | null
}


export async function listArtists(): Promise<Artist[]> {
  const supabase = await createClient()
  const workspaceId = await getCurrentWorkspaceId()

  const data = await readCompleteCollection<Artist>(async (from, to) => {
    const { data, error, count } = await supabase
      .from("artists")
      .select("*", { count: "exact" })
      .eq("workspace_id", workspaceId)
      .order("name", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to)

    return {
      data: data as unknown as Artist[] | null,
      error,
      count,
    }
  }, "Artists")

  return data.map((artist) => ({
    ...artist,
    stage_name: artist.stage_name || artist.name || "Unknown",
    real_name: artist.surname
      ? `${artist.name || ""} ${artist.surname}`.trim()
      : artist.name,
    genre: artist.genres?.[0] || null,
    genres: artist.genres ?? [],
    base_rate: artist.fee ?? null,
    social_links: artist.social_links ?? [],
    documents: artist.documents ?? [],
    profile_image_url: artist.profile_image_url ?? null,
  }))
}

// Alias for backwards compatibility and clearer naming
export async function getArtists(): Promise<Artist[]> {
  return listArtists()
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
    stage_name: data.stage_name || data.name || "Unknown",
    real_name: data.surname ? `${data.name || ""} ${data.surname}`.trim() : data.name,
    genre: data.genres?.[0] || null,
    genres: data.genres ?? [],
    base_rate: data.fee ?? null,
    social_links: data.social_links ?? [],
    documents: data.documents ?? [],
    profile_image_url: data.profile_image_url ?? null,
  }
}

export async function createArtist(
  input: CreateArtistInput,
): Promise<{ success: boolean; artistId?: string; error?: string }> {
  const validated = createArtistSchema.safeParse(input)
  if (!validated.success) {
    return { success: false, error: validated.error.issues[0].message }
  }
  input = validated.data

  const supabase = await createClient()
  const workspaceId = await getCurrentWorkspaceId()

  const { data, error } = await supabase
    .from("artists")
    .insert({
      workspace_id: workspaceId,
      name: input.name?.trim() || input.stage_name,
      stage_name: input.stage_name,
      surname: input.surname || null,
      location: input.location || null,
      // Contact info - use contact_name for notes if provided
      email: input.email || null,
      phone: input.phone || null,
      notes: withArtistContact(input.notes, input.contact_name),
      // Pricing
      fee: input.fee ?? null,
      currency: input.currency === undefined ? "USD" : input.currency,
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


export async function updateArtist(
  id: string,
  input: UpdateArtistInput,
): Promise<{ success: boolean; error?: string }> {
  if (typeof id !== "string" || !id.trim()) {
    return { success: false, error: "Artist is required" }
  }
  const validated = updateArtistSchema.safeParse(input)
  if (!validated.success) {
    return { success: false, error: validated.error.issues[0].message }
  }
  input = validated.data
  const supabase = await createClient()
  const workspaceId = await getCurrentWorkspaceId()

  // Read contact-note context only within the authoritative workspace.
  const { data: existing } = await supabase
    .from("artists")
    .select("id, notes")
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
  }
  if (input.name !== undefined) updateData.name = input.name
  if (input.surname !== undefined) updateData.surname = input.surname || null
  if (input.location !== undefined) updateData.location = input.location || null
  if (input.email !== undefined) updateData.email = input.email || null
  if (input.phone !== undefined) updateData.phone = input.phone || null
  if (input.notes !== undefined || input.contact_name !== undefined) {
    const notes = input.notes !== undefined ? input.notes : existing.notes
    updateData.notes = withArtistContact(notes, input.contact_name)
  }
  if (input.fee !== undefined) updateData.fee = input.fee
  if (input.currency !== undefined) updateData.currency = input.currency
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

  const { data: updated, error } = await supabase
    .from("artists")
    .update(updateData)
    .eq("id", id)
    .eq("workspace_id", workspaceId)
    .select("id")
    .single()

  if (error) {
    return { success: false, error: error.message }
  }

  if (!updated) return { success: false, error: "Artist not found" }

  revalidatePath("/dashboard/artists")
  revalidatePath(`/dashboard/artists/${id}`)
  revalidatePath("/dashboard")

  return { success: true }
}
