"use server"

import { revalidatePath } from "next/cache"
import { readCompleteCollection } from "@/lib/read-complete-collection"
import { createClient } from "@/lib/supabase/server"
import { configuredCalendarDay } from "@/lib/calendar-day"
import { getCurrentWorkspaceId } from "./workspace"
import {
  dateOfBirthSchema, firstIssue, travelDocumentSchema, travelRecordIdSchema,
  type TravelDocumentInput, type TravelDocumentType,
} from "@/lib/booking-travel-validation"

// Artist identity documents and date of birth (migration 009, decisions 3-4). Sensitive
// personal data: read ONLY here, through explicit projections, for the artist profile section
// and the read-only block of a booking's Travel tab. Never in list, selector, dashboard or
// export reads; never logged (only the provider error code); never echoed in error copy.

export interface ArtistTravelDocument {
  id: string
  artist_id: string
  doc_type: TravelDocumentType
  number: string
  issuing_country: string | null
  expires_on: string | null
  holder_name: string | null
}

export interface ArtistTravelProfile {
  artistId: string
  dateOfBirth: string | null
  documents: ArtistTravelDocument[]
}

export type TravelDocumentActionResult = { success: true } | { success: false; error: string }

const DOCUMENT_COLUMNS = "id,artist_id,doc_type,number,issuing_country,expires_on,holder_name"

const ARTIST_NOT_FOUND = "Artist not found"
const DOCUMENT_NOT_FOUND = "Travel document not found"
const LOAD_FAILED = "Unable to load travel documents. Please try again."
const SAVE_FAILED = "Unable to save the travel document. Please try again."
const DELETE_FAILED = "Unable to delete the travel document. Please try again."
const BIRTH_DATE_FAILED = "Unable to save the date of birth. Please try again."
const REJECTED_BY_DATABASE = "These details were not accepted. Check the values and try again."

type ProviderError = { code?: string | null } | null

/** Logs only the SQLSTATE: provider messages and details can echo document numbers. */
function logFailure(label: string, error: ProviderError) {
  console.error(label, { code: error?.code ?? "unknown" })
}

async function scopedClient() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  return { supabase, workspaceId: await getCurrentWorkspaceId() }
}

function revalidateArtist(artistId: string) {
  revalidatePath(`/dashboard/artists/${artistId}`)
}

/** Date of birth and every travel document of one artist in the selected workspace. */
export async function getArtistTravelProfile(artistId: string): Promise<ArtistTravelProfile | null> {
  if (!travelRecordIdSchema.safeParse(artistId).success) throw new Error("Invalid artist ID")
  const scope = await scopedClient()
  if (!scope) throw new Error("Not authenticated")
  const { supabase, workspaceId } = scope
  try {
    const { data: artist, error } = await supabase.from("artists")
      .select("id,date_of_birth")
      .eq("id", artistId).eq("workspace_id", workspaceId)
      .maybeSingle()
    if (error) throw new Error("artist read failed")
    if (!artist) return null
    const documents = await readCompleteCollection<ArtistTravelDocument>(async (from, to) => {
      const { data, error, count } = await supabase.from("artist_travel_documents")
        .select(DOCUMENT_COLUMNS, { count: "exact" })
        .eq("workspace_id", workspaceId).eq("artist_id", artistId)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to)
      return { data: data as ArtistTravelDocument[] | null, error, count }
    }, "Travel documents")
    return { artistId, dateOfBirth: (artist as { date_of_birth: string | null }).date_of_birth, documents }
  } catch {
    console.error("Error loading artist travel documents")
    throw new Error(LOAD_FAILED)
  }
}

export async function createArtistTravelDocument(artistId: string, input: TravelDocumentInput): Promise<TravelDocumentActionResult> {
  if (!travelRecordIdSchema.safeParse(artistId).success) return { success: false, error: ARTIST_NOT_FOUND }
  const parsed = travelDocumentSchema.safeParse(input)
  if (!parsed.success) return { success: false, error: firstIssue(parsed.error) }
  const scope = await scopedClient()
  if (!scope) return { success: false, error: "Not authenticated" }
  const { data, error } = await scope.supabase.from("artist_travel_documents")
    .insert({ ...parsed.data, workspace_id: scope.workspaceId, artist_id: artistId })
    .select("id").maybeSingle()
  if (error) {
    logFailure("Error creating travel document:", error)
    if (error.code === "23503") return { success: false, error: ARTIST_NOT_FOUND }
    return { success: false, error: error.code === "23514" ? REJECTED_BY_DATABASE : SAVE_FAILED }
  }
  if (!data) return { success: false, error: SAVE_FAILED }
  revalidateArtist(artistId)
  return { success: true }
}

export async function updateArtistTravelDocument(artistId: string, documentId: string, input: TravelDocumentInput): Promise<TravelDocumentActionResult> {
  if (!travelRecordIdSchema.safeParse(artistId).success || !travelRecordIdSchema.safeParse(documentId).success) {
    return { success: false, error: DOCUMENT_NOT_FOUND }
  }
  const parsed = travelDocumentSchema.safeParse(input)
  if (!parsed.success) return { success: false, error: firstIssue(parsed.error) }
  const scope = await scopedClient()
  if (!scope) return { success: false, error: "Not authenticated" }
  const { data, error } = await scope.supabase.from("artist_travel_documents")
    .update({ ...parsed.data, updated_at: new Date().toISOString() })
    .eq("id", documentId).eq("artist_id", artistId).eq("workspace_id", scope.workspaceId)
    .select("id").maybeSingle()
  if (error) {
    logFailure("Error updating travel document:", error)
    return { success: false, error: error.code === "23514" ? REJECTED_BY_DATABASE : SAVE_FAILED }
  }
  if (!data) return { success: false, error: DOCUMENT_NOT_FOUND }
  revalidateArtist(artistId)
  return { success: true }
}

export async function deleteArtistTravelDocument(artistId: string, documentId: string): Promise<TravelDocumentActionResult> {
  if (!travelRecordIdSchema.safeParse(artistId).success || !travelRecordIdSchema.safeParse(documentId).success) {
    return { success: false, error: DOCUMENT_NOT_FOUND }
  }
  const scope = await scopedClient()
  if (!scope) return { success: false, error: "Not authenticated" }
  const { data, error } = await scope.supabase.from("artist_travel_documents")
    .delete()
    .eq("id", documentId).eq("artist_id", artistId).eq("workspace_id", scope.workspaceId)
    .select("id").maybeSingle()
  if (error) {
    logFailure("Error deleting travel document:", error)
    return { success: false, error: DELETE_FAILED }
  }
  if (!data) return { success: false, error: DOCUMENT_NOT_FOUND }
  revalidateArtist(artistId)
  return { success: true }
}

/** Sets or clears (null or "") the artist's date of birth. Writes only that column. */
export async function updateArtistDateOfBirth(artistId: string, value: string | null): Promise<TravelDocumentActionResult> {
  if (!travelRecordIdSchema.safeParse(artistId).success) return { success: false, error: ARTIST_NOT_FOUND }
  const parsed = dateOfBirthSchema(configuredCalendarDay()).safeParse(value)
  if (!parsed.success) return { success: false, error: firstIssue(parsed.error) }
  const scope = await scopedClient()
  if (!scope) return { success: false, error: "Not authenticated" }
  const { data, error } = await scope.supabase.from("artists")
    .update({ date_of_birth: parsed.data })
    .eq("id", artistId).eq("workspace_id", scope.workspaceId)
    .select("id").maybeSingle()
  if (error) {
    logFailure("Error updating date of birth:", error)
    return { success: false, error: error.code === "23514" ? REJECTED_BY_DATABASE : BIRTH_DATE_FAILED }
  }
  if (!data) return { success: false, error: ARTIST_NOT_FOUND }
  revalidateArtist(artistId)
  return { success: true }
}
