import { unstable_rethrow } from "next/navigation"
import type { SupabaseClient } from "@supabase/supabase-js"
import { createClient } from "@/lib/supabase/server"
import { createPrivilegedClient, travelDocumentScansEnabled } from "@/lib/supabase/privileged"
import { getCurrentWorkspaceId } from "@/lib/actions/workspace"
import {
  SCAN_DOWNLOAD_TTL_SECONDS, TRAVEL_DOCUMENT_BUCKET, inspectScanBytes, isScanMediaType, scanDownloadName,
} from "@/lib/travel-document-scan"

// Trusted server path for travel-document scans (owner decision on PR #36: D2, D3, D5).
// Order of every operation:
//   1. flag on, session user verified with the user client (cookie session, Auth server check);
//   2. canonical workspace = the user's selected workspace with an active membership;
//   3. privileged client: one backbeat_travel_document_* function that re-reads membership and
//      the workspace -> artist -> card -> version binding and writes the automatic audit row
//      in the same transaction (committed when the call returns);
//   4. only then Storage (sign / upload URL / read bytes); 5. for a download, the lifecycle
//      fence + outcome row before the link leaves the server.
// The browser sends app ids only: never a Storage key, a TTL or a reason. It receives a key
// only inside the one-time signed upload URL of its own reservation, never from a read. Nothing here logs a
// key, token, link, file content or provider message: only a fixed label and the SQLSTATE.

export type ScanFailure =
  | "disabled" | "unauthenticated" | "not_found" | "not_allowed" | "invalid_context"
  | "missing_file" | "invalid_file" | "unavailable"

export const SCAN_FAILURE_COPY: Record<ScanFailure, string> = {
  disabled: "Scan storage is not enabled yet.",
  unauthenticated: "Not authenticated",
  not_found: "Scan not found.",
  not_allowed: "This scan is not available. Reload the page and try again.",
  invalid_context: "This scan does not belong to this booking's artist.",
  missing_file: "The scan file is missing. Upload it again.",
  invalid_file: "The file was not accepted. Use a PDF, JPEG, PNG or HEIC file of 10 MB or less.",
  unavailable: "Scan storage is unavailable. Please try again.",
}
export const SCAN_FAILURE_STATUS: Record<ScanFailure, number> = {
  disabled: 503, unauthenticated: 401, not_found: 404, not_allowed: 409, invalid_context: 400,
  missing_file: 409, invalid_file: 422, unavailable: 503,
}

type ProviderError = { code?: string | null } | null
type Failed = { ok: false; failure: ScanFailure }
type Scope = { ok: true; userId: string; workspaceId: string; admin: SupabaseClient }

function logFailure(label: string, error: ProviderError | undefined) {
  console.error(label, { code: error?.code ?? "unknown" })
}

function failureFor(error: ProviderError): ScanFailure {
  switch (error?.code) {
    case "BB013": return "not_allowed"       // actor is not an active member of the workspace
    case "BB014": return "not_found"         // unknown id or outside the selected workspace
    case "BB015": return "not_allowed"       // lifecycle state: archived, replaced, not pending...
    case "BB017": return "invalid_context"
    case "BB020": return "missing_file"
    default: return "unavailable"
  }
}

/** True only when Storage says THIS object does not exist. A missing bucket is an outage. */
function isObjectNotFound(error: unknown): boolean {
  const e = error as { status?: unknown; statusCode?: unknown; message?: unknown } | null
  const message = typeof e?.message === "string" ? e.message : ""
  if (/bucket/i.test(message)) return false
  return e?.status === 404 || e?.statusCode === "404" || e?.statusCode === 404 || /not[ _]?found/i.test(message)
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer)
  return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, "0")).join("")
}

/** Steps 1-2, then the privileged client. No privileged call happens before this resolves. */
async function resolveScope(): Promise<Scope | Failed> {
  if (!travelDocumentScansEnabled()) return { ok: false, failure: "disabled" }
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) return { ok: false, failure: "unauthenticated" }
  let workspaceId: string
  try {
    workspaceId = await getCurrentWorkspaceId()
  } catch (caught) {
    unstable_rethrow(caught)
    return { ok: false, failure: "not_allowed" }
  }
  const admin = createPrivilegedClient()
  if (!admin) return { ok: false, failure: "unavailable" }
  return { ok: true, userId: user.id, workspaceId, admin }
}

/** Reads the stored object. "absent" only when Storage says the object does not exist. */
async function readObject(admin: SupabaseClient, key: string): Promise<Uint8Array | "absent" | "error"> {
  try {
    const { data, error } = await admin.storage.from(TRAVEL_DOCUMENT_BUCKET).download(key)
    if (error || !data) return isObjectNotFound(error) ? "absent" : "error"
    return new Uint8Array(await data.arrayBuffer())
  } catch {
    return "error"
  }
}

/**
 * Re-verifies the bytes of the current scan of a restored card against the recorded size and
 * digest. The database makes the comparison: equal -> ready, absent or different -> missing.
 */
async function verifyRestoredScan(scope: Scope, fileId: string): Promise<"ready" | "missing" | "error"> {
  const probe = await scope.admin.rpc("backbeat_travel_document_restore_probe", {
    p_actor: scope.userId, p_workspace_id: scope.workspaceId, p_file_id: fileId,
  })
  if (probe.error || typeof probe.data !== "string") return "error"
  const bytes = await readObject(scope.admin, probe.data)
  if (bytes === "error") return "error"
  const confirmed = await scope.admin.rpc("backbeat_travel_document_confirm_restored_file", {
    p_actor: scope.userId, p_workspace_id: scope.workspaceId, p_file_id: fileId,
    p_observed_size: bytes === "absent" ? null : bytes.length,
    p_observed_sha256: bytes === "absent" ? null : await sha256Hex(bytes),
  })
  if (confirmed.error) return "error"
  return confirmed.data === "ready" ? "ready" : "missing"
}

export type ScanDownloadRequest = { fileId: string; bookingId?: string | null; eventId?: string | null }
export type ScanDownloadResult = { ok: true; url: string } | Failed

/**
 * One download request = one new request id = at most one authorization event and one outcome
 * event. The exact-version link (fixed TTL, attachment disposition) is returned only when the
 * authorization committed, the signer succeeded and the lifecycle fence passed afterwards.
 */
export async function issueScanDownload(request: ScanDownloadRequest): Promise<ScanDownloadResult> {
  const scope = await resolveScope()
  if (!scope.ok) return scope
  const { admin, userId, workspaceId } = scope

  const authorize = (requestId: string) => admin.rpc("backbeat_travel_document_authorize_download", {
    p_actor: userId, p_workspace_id: workspaceId, p_file_id: request.fileId, p_request_id: requestId,
    p_booking_id: request.bookingId ?? null, p_event_id: request.eventId ?? null,
  })
  let requestId = crypto.randomUUID()
  let authorized = await authorize(requestId)
  if (authorized.error?.code === "BB020") {
    // Scan of a restored card: verify the bytes first, then ask again as a fresh request.
    const verified = await verifyRestoredScan(scope, request.fileId)
    if (verified !== "ready") return { ok: false, failure: verified === "missing" ? "missing_file" : "unavailable" }
    requestId = crypto.randomUUID()
    authorized = await authorize(requestId)
  }
  if (authorized.error) {
    logFailure("Travel document download not authorized:", authorized.error)
    return { ok: false, failure: failureFor(authorized.error) }
  }
  const grant = (Array.isArray(authorized.data) ? authorized.data[0] : authorized.data) as
    | { object_key?: unknown; document_generation?: unknown; media_type?: unknown; doc_type?: unknown } | null | undefined
  if (!grant || typeof grant.object_key !== "string" || !isScanMediaType(grant.media_type)
      || (typeof grant.document_generation !== "number" && typeof grant.document_generation !== "string")) {
    return { ok: false, failure: "unavailable" }
  }

  // The authorization event is committed. Only now is the signer called.
  let url: string | null = null
  try {
    const signed = await admin.storage.from(TRAVEL_DOCUMENT_BUCKET).createSignedUrl(
      grant.object_key, SCAN_DOWNLOAD_TTL_SECONDS,
      { download: scanDownloadName(String(grant.doc_type ?? ""), grant.media_type) })
    if (!signed.error && typeof signed.data?.signedUrl === "string" && signed.data.signedUrl) url = signed.data.signedUrl
  } catch {
    url = null
  }

  // Fence + outcome row. A request that lost to archive, replacement or membership removal
  // gets no link; a signer failure stays an authorized attempt, never a release.
  const released = await admin.rpc("backbeat_travel_document_record_issuance", {
    p_actor: userId, p_workspace_id: workspaceId, p_file_id: request.fileId, p_request_id: requestId,
    p_generation: grant.document_generation, p_signed: url !== null,
  })
  if (released.error) {
    logFailure("Travel document download outcome not recorded:", released.error)
    return { ok: false, failure: "unavailable" }
  }
  if (released.data !== true || url === null) {
    return { ok: false, failure: url === null ? "unavailable" : "not_allowed" }
  }
  return { ok: true, url }
}

export type ScanUploadReservation = { ok: true; fileId: string; uploadUrl: string } | Failed

/**
 * Reserves a pending, unservable version and returns a create-only signed upload URL for its
 * allocated key. The URL is an upload capability only: it cannot read, list, sign, overwrite
 * or remove, and the version is unusable until finalizeScanUpload validated the stored bytes.
 */
export async function reserveScanUpload(documentId: string): Promise<ScanUploadReservation> {
  const scope = await resolveScope()
  if (!scope.ok) return scope
  const reserved = await scope.admin.rpc("backbeat_travel_document_reserve_upload", {
    p_actor: scope.userId, p_workspace_id: scope.workspaceId, p_document_id: documentId,
  })
  if (reserved.error) {
    logFailure("Travel document upload not reserved:", reserved.error)
    return { ok: false, failure: failureFor(reserved.error) }
  }
  const row = (Array.isArray(reserved.data) ? reserved.data[0] : reserved.data) as
    | { file_id?: unknown; object_key?: unknown } | null | undefined
  if (!row || typeof row.file_id !== "string" || typeof row.object_key !== "string") {
    return { ok: false, failure: "unavailable" }
  }
  try {
    const signed = await scope.admin.storage.from(TRAVEL_DOCUMENT_BUCKET).createSignedUploadUrl(row.object_key)
    if (signed.error || typeof signed.data?.signedUrl !== "string") return { ok: false, failure: "unavailable" }
    return { ok: true, fileId: row.file_id, uploadUrl: signed.data.signedUrl }
  } catch {
    return { ok: false, failure: "unavailable" }
  }
}

export type ScanFinalizeResult = { ok: true } | Failed

/**
 * Validates the stored object (observed bytes: type, size; digest) and publishes it as the
 * card's current version, or records why it was never admitted. A transient Storage error
 * leaves the reservation pending so the same finalize can be retried.
 */
export async function finalizeScanUpload(fileId: string): Promise<ScanFinalizeResult> {
  const scope = await resolveScope()
  if (!scope.ok) return scope
  const { admin, userId, workspaceId } = scope
  const pending = await admin.rpc("backbeat_travel_document_pending_key", {
    p_actor: userId, p_workspace_id: workspaceId, p_file_id: fileId,
  })
  if (pending.error || typeof pending.data !== "string") {
    logFailure("Travel document upload not finalizable:", pending.error)
    return { ok: false, failure: pending.error ? failureFor(pending.error) : "unavailable" }
  }
  const bytes = await readObject(admin, pending.data)
  if (bytes === "error") return { ok: false, failure: "unavailable" }
  const verdict = bytes === "absent" ? null : inspectScanBytes(bytes)
  const valid = verdict?.ok ? verdict : null
  const finalized = await admin.rpc("backbeat_travel_document_finalize_upload", {
    p_actor: userId, p_workspace_id: workspaceId, p_file_id: fileId,
    p_media_type: valid?.mediaType ?? null, p_byte_size: valid?.byteSize ?? null,
    p_sha256: valid && bytes !== "absent" ? await sha256Hex(bytes) : null,
    p_reject_reason: valid ? null : bytes === "absent" ? "missing_bytes" : "invalid_bytes",
  })
  if (finalized.error) {
    logFailure("Travel document upload not finalized:", finalized.error)
    return { ok: false, failure: failureFor(finalized.error) }
  }
  if (finalized.data === "ready") return { ok: true }
  if (bytes === "absent") return { ok: false, failure: "missing_file" }
  // Rejected with valid bytes = the card was archived or restored meanwhile (lost generation).
  return { ok: false, failure: valid ? "not_allowed" : "invalid_file" }
}
