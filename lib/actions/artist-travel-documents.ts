"use server"

import { revalidatePath } from "next/cache"
import { readCompleteCollection } from "@/lib/read-complete-collection"
import { createClient } from "@/lib/supabase/server"
import { travelDocumentScansEnabled } from "@/lib/supabase/privileged"
import { configuredCalendarDay } from "@/lib/calendar-day"
import { getCurrentWorkspaceId } from "./workspace"
import {
  dateOfBirthSchema, firstIssue, travelDocumentSchema, travelRecordIdSchema,
  type TravelDocumentInput, type TravelDocumentType,
} from "@/lib/booking-travel-validation"
import { isScanMediaType, type ScanMediaType } from "@/lib/travel-document-scan"
import { SCAN_FAILURE_COPY, finalizeScanUpload, reserveScanUpload } from "@/lib/travel-documents/scan-service"

// Artist identity documents and date of birth (migration 009; owner decision on PR #36, D1-D5).
// Sensitive personal data: read ONLY here, through explicit projections, for the artist profile
// section and the read-only block of a booking's Travel tab. Never in list, selector, dashboard
// or export reads; never logged (only the provider error code); never echoed in error copy;
// never attached to or sent with a booking, email, PDF or portal by the application.
// Every active member of the workspace can read, create, edit, archive (recoverable delete) and
// restore. There is no hard delete here or anywhere in the application.
// Date of birth: artists.date_of_birth, a separate optional field of the artist (not of a
// document, not the issue date). Read by getArtistTravelProfile, written by
// updateArtistDateOfBirth only; outside the document lifecycle and the document audit.

export type TravelDocumentScanState = "ready" | "restore_pending" | "missing"

export interface TravelDocumentScan {
  fileId: string
  state: TravelDocumentScanState
  mediaType: ScanMediaType | null
  byteSize: number | null
}

export interface ArtistTravelDocument {
  id: string
  artist_id: string
  doc_type: TravelDocumentType
  number: string
  issuing_country: string | null
  nationality: string | null
  issued_on: string | null
  expires_on: string | null
  holder_name: string | null
  /** Current scan version, or null. Never a Storage path or link. */
  scan: TravelDocumentScan | null
}

/** Recovery view of an archived card: enough to recognise and restore it, not the full card. */
export interface ArchivedTravelDocument {
  id: string
  doc_type: TravelDocumentType
  holder_name: string | null
  expires_on: string | null
  archived_at: string
  /** Recovery cutoff: restorable strictly before this instant. */
  restore_until: string
  cause: "deleted" | "relationship_ended"
  /** False once the recovery window closed. */
  restorable: boolean
  hasScan: boolean
}

export interface TravelDocumentActivity {
  id: string
  action: string
  detail: string | null
  documentId: string | null
  /** "you", another active "member", or "system" (operator maintenance). No user ids. */
  actor: "you" | "member" | "system"
  withBooking: boolean
  occurredAt: string
}

export interface ArtistTravelProfile {
  artistId: string
  dateOfBirth: string | null
  documents: ArtistTravelDocument[]
  archived: ArchivedTravelDocument[]
  /** Set while "End relationship" is in force: no new card and no restore until resumed. */
  relationshipEndedAt: string | null
  /** Latest automatic audit events of this artist's documents, newest first. */
  activity: TravelDocumentActivity[]
  /** Server flag TRAVEL_DOC_SCANS_ENABLED: off = no upload and no download controls. */
  scansEnabled: boolean
}

export type TravelDocumentActionResult = { success: true } | { success: false; error: string }
export type ScanReservationResult =
  | { success: true; fileId: string; uploadUrl: string } | { success: false; error: string }

const DOCUMENT_COLUMNS = "id,artist_id,doc_type,number,issuing_country,nationality,issued_on,expires_on,holder_name,current_file_id"
const ARCHIVED_COLUMNS = "id,doc_type,holder_name,expires_on,archived_at,restore_until,archive_cause,state,current_file_id"
const SCAN_COLUMNS = "id,document_id,state,media_type,byte_size"
const ACTIVITY_COLUMNS = "id,action,detail,document_id,actor_id,booking_id,occurred_at"
const ACTIVITY_LIMIT = 50

const ARTIST_NOT_FOUND = "Artist not found"
const DOCUMENT_NOT_FOUND = "Travel document not found"
const LOAD_FAILED = "Unable to load travel documents. Please try again."
const SAVE_FAILED = "Unable to save the travel document. Please try again."
const DELETE_FAILED = "Unable to delete the travel document. Please try again."
const RESTORE_FAILED = "Unable to restore the travel document. Please try again."
const RESTORE_WINDOW_CLOSED = "This travel document can no longer be restored."
const RELATIONSHIP_ENDED = "The relationship with this artist is ended. Resume it first."
const RELATIONSHIP_FAILED = "Unable to update the relationship. Please try again."
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
  return { supabase, userId: user.id, workspaceId: await getCurrentWorkspaceId() }
}

function revalidateArtist(artistId: string) {
  revalidatePath(`/dashboard/artists/${artistId}`)
}

type DocumentRow = Omit<ArtistTravelDocument, "scan"> & { current_file_id: string | null }
type ArchivedRow = {
  id: string; doc_type: TravelDocumentType; holder_name: string | null; expires_on: string | null
  archived_at: string; restore_until: string; archive_cause: "deleted" | "relationship_ended"
  state: string; current_file_id: string | null
}
type ScanRow = { id: string; document_id: string; state: string; media_type: string | null; byte_size: number | null }
type ActivityRow = {
  id: string; action: string; detail: string | null; document_id: string | null
  actor_id: string | null; booking_id: string | null; occurred_at: string
}

/**
 * Date of birth, active cards with their current scan, archived cards still on record, the
 * relationship signal and the latest audit events of one artist in the selected workspace.
 * Active cards are the ordinary read; archived cards come back as a reduced recovery view.
 */
export async function getArtistTravelProfile(artistId: string): Promise<ArtistTravelProfile | null> {
  if (!travelRecordIdSchema.safeParse(artistId).success) throw new Error("Invalid artist ID")
  const scope = await scopedClient()
  if (!scope) throw new Error("Not authenticated")
  const { supabase, workspaceId, userId } = scope
  try {
    const { data: artist, error } = await supabase.from("artists")
      .select("id,date_of_birth")
      .eq("id", artistId).eq("workspace_id", workspaceId)
      .maybeSingle()
    if (error) throw new Error("artist read failed")
    if (!artist) return null
    const cards = (state: string[], columns: string, label: string) =>
      readCompleteCollection<{ id: string } & Record<string, unknown>>(async (from, to) => {
        const { data, error, count } = await supabase.from("artist_travel_documents")
          .select(columns, { count: "exact" })
          .eq("workspace_id", workspaceId).eq("artist_id", artistId).in("state", state)
          .order("created_at", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to)
        return { data: data as unknown as ({ id: string } & Record<string, unknown>)[] | null, error, count }
      }, label)
    const [activeRows, archivedRows, relationship, activity] = await Promise.all([
      cards(["active"], DOCUMENT_COLUMNS, "Travel documents") as unknown as Promise<DocumentRow[]>,
      cards(["archived"], ARCHIVED_COLUMNS, "Archived travel documents") as unknown as Promise<ArchivedRow[]>,
      supabase.from("artist_travel_document_relationships")
        .select("ended_at").eq("workspace_id", workspaceId).eq("artist_id", artistId).maybeSingle(),
      supabase.from("artist_travel_document_audit")
        .select(ACTIVITY_COLUMNS).eq("workspace_id", workspaceId).eq("artist_id", artistId)
        .order("seq", { ascending: false }).limit(ACTIVITY_LIMIT),
    ])
    if (relationship.error || activity.error) throw new Error("travel document read failed")

    const scans = new Map<string, ScanRow>()
    const scanIds = activeRows.map(row => row.current_file_id).filter((id): id is string => !!id)
    if (scanIds.length > 0) {
      const { data, error: scanError } = await supabase.from("artist_travel_document_files")
        .select(SCAN_COLUMNS).eq("workspace_id", workspaceId).in("id", scanIds).limit(scanIds.length)
      if (scanError || !data) throw new Error("scan read failed")
      for (const row of data as ScanRow[]) scans.set(row.id, row)
    }
    const now = Date.now()
    return {
      artistId,
      dateOfBirth: (artist as { date_of_birth: string | null }).date_of_birth,
      documents: activeRows.map(({ current_file_id, ...card }) => {
        const scan = current_file_id ? scans.get(current_file_id) : undefined
        const state = scan?.state
        return {
          ...card,
          scan: scan && scan.document_id === card.id && (state === "ready" || state === "restore_pending" || state === "missing")
            ? { fileId: scan.id, state, mediaType: isScanMediaType(scan.media_type) ? scan.media_type : null, byteSize: scan.byte_size }
            : null,
        }
      }),
      archived: archivedRows.map(row => ({
        id: row.id, doc_type: row.doc_type, holder_name: row.holder_name, expires_on: row.expires_on,
        archived_at: row.archived_at, restore_until: row.restore_until, cause: row.archive_cause,
        restorable: row.state === "archived" && now < Date.parse(row.restore_until),
        hasScan: row.current_file_id !== null,
      })),
      relationshipEndedAt: (relationship.data as { ended_at: string | null } | null)?.ended_at ?? null,
      activity: ((activity.data ?? []) as ActivityRow[]).map(row => ({
        id: row.id, action: row.action, detail: row.detail, documentId: row.document_id,
        actor: row.actor_id === null ? "system" : row.actor_id === userId ? "you" : "member",
        withBooking: row.booking_id !== null, occurredAt: row.occurred_at,
      })),
      scansEnabled: travelDocumentScansEnabled(),
    }
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
    if (error.code === "BB019") return { success: false, error: RELATIONSHIP_ENDED }
    return { success: false, error: error.code === "23514" ? REJECTED_BY_DATABASE : SAVE_FAILED }
  }
  if (!data) return { success: false, error: SAVE_FAILED }
  revalidateArtist(artistId)
  return { success: true }
}

/** Edits an ACTIVE card. An archived card is not editable in place: zero rows -> not found. */
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
    .eq("id", documentId).eq("artist_id", artistId).eq("workspace_id", scope.workspaceId).eq("state", "active")
    .select("id").maybeSingle()
  if (error) {
    logFailure("Error updating travel document:", error)
    return { success: false, error: error.code === "23514" ? REJECTED_BY_DATABASE : SAVE_FAILED }
  }
  if (!data) return { success: false, error: DOCUMENT_NOT_FOUND }
  revalidateArtist(artistId)
  return { success: true }
}

/**
 * "Delete" = recoverable archive (D1, D5): the card and its scan stay on record, restorable for
 * 12 calendar months; nothing is removed from the database or from Storage. A repeat is a no-op.
 */
export async function deleteArtistTravelDocument(artistId: string, documentId: string): Promise<TravelDocumentActionResult> {
  if (!travelRecordIdSchema.safeParse(artistId).success || !travelRecordIdSchema.safeParse(documentId).success) {
    return { success: false, error: DOCUMENT_NOT_FOUND }
  }
  const scope = await scopedClient()
  if (!scope) return { success: false, error: "Not authenticated" }
  const { data, error } = await scope.supabase.rpc("backbeat_travel_document_archive", {
    p_workspace_id: scope.workspaceId, p_document_id: documentId,
  })
  if (error) {
    logFailure("Error archiving travel document:", error)
    return { success: false, error: error.code === "BB014" ? DOCUMENT_NOT_FOUND : DELETE_FAILED }
  }
  if (data !== "archived" && data !== "already_archived") return { success: false, error: DELETE_FAILED }
  revalidateArtist(artistId)
  return { success: true }
}

/** Restores an archived card strictly inside its recovery window. Never automatic. */
export async function restoreArtistTravelDocument(artistId: string, documentId: string): Promise<TravelDocumentActionResult> {
  if (!travelRecordIdSchema.safeParse(artistId).success || !travelRecordIdSchema.safeParse(documentId).success) {
    return { success: false, error: DOCUMENT_NOT_FOUND }
  }
  const scope = await scopedClient()
  if (!scope) return { success: false, error: "Not authenticated" }
  const { data, error } = await scope.supabase.rpc("backbeat_travel_document_restore", {
    p_workspace_id: scope.workspaceId, p_document_id: documentId,
  })
  if (error) {
    logFailure("Error restoring travel document:", error)
    if (error.code === "BB014") return { success: false, error: DOCUMENT_NOT_FOUND }
    if (error.code === "BB016") return { success: false, error: RESTORE_WINDOW_CLOSED }
    if (error.code === "BB019") return { success: false, error: RELATIONSHIP_ENDED }
    return { success: false, error: RESTORE_FAILED }
  }
  if (data !== "restored" && data !== "already_active") return { success: false, error: RESTORE_FAILED }
  revalidateArtist(artistId)
  return { success: true }
}

/**
 * "End relationship": archives every active travel document of the artist and starts their
 * 12-month recovery windows. Documents archived earlier keep their own cutoff.
 */
export async function endArtistRelationship(artistId: string): Promise<TravelDocumentActionResult> {
  return relationshipAction(artistId, "backbeat_travel_document_relationship_end")
}

/** "Resume relationship": re-enables new cards and per-document restore. Restores nothing itself. */
export async function resumeArtistRelationship(artistId: string): Promise<TravelDocumentActionResult> {
  return relationshipAction(artistId, "backbeat_travel_document_relationship_resume")
}

async function relationshipAction(artistId: string, fn: string): Promise<TravelDocumentActionResult> {
  if (!travelRecordIdSchema.safeParse(artistId).success) return { success: false, error: ARTIST_NOT_FOUND }
  const scope = await scopedClient()
  if (!scope) return { success: false, error: "Not authenticated" }
  const { error } = await scope.supabase.rpc(fn, { p_workspace_id: scope.workspaceId, p_artist_id: artistId })
  if (error) {
    logFailure("Error updating artist relationship:", error)
    return { success: false, error: error.code === "BB014" ? ARTIST_NOT_FOUND : RELATIONSHIP_FAILED }
  }
  revalidateArtist(artistId)
  return { success: true }
}

/** Step 1 of a scan upload: reserve a pending version and get its one-time upload link. */
export async function reserveTravelDocumentScan(artistId: string, documentId: string): Promise<ScanReservationResult> {
  if (!travelRecordIdSchema.safeParse(artistId).success || !travelRecordIdSchema.safeParse(documentId).success) {
    return { success: false, error: DOCUMENT_NOT_FOUND }
  }
  const reserved = await reserveScanUpload(documentId)
  if (!reserved.ok) return { success: false, error: SCAN_FAILURE_COPY[reserved.failure] }
  return { success: true, fileId: reserved.fileId, uploadUrl: reserved.uploadUrl }
}

/** Step 3 of a scan upload: the server validates the stored bytes and publishes the version. */
export async function finalizeTravelDocumentScan(artistId: string, fileId: string): Promise<TravelDocumentActionResult> {
  if (!travelRecordIdSchema.safeParse(artistId).success || !travelRecordIdSchema.safeParse(fileId).success) {
    return { success: false, error: DOCUMENT_NOT_FOUND }
  }
  const finalized = await finalizeScanUpload(fileId)
  // The card changed either way (new current scan, or a rejected attempt in the activity list).
  revalidateArtist(artistId)
  if (!finalized.ok) return { success: false, error: SCAN_FAILURE_COPY[finalized.failure] }
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
