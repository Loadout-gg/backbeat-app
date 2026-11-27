import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js"
import { getSupabaseEnvironment } from "./environment"

// Privileged (service-role) Supabase client for travel-document scans ONLY (owner decision on
// PR #36, D2). Server-only: it never reads cookies, never carries a user session and is never
// imported by a client component. Its key bypasses RLS project-wide, so the only module allowed
// to import this file is lib/travel-documents/scan-service.ts, which calls it strictly after the
// session user was verified, and only for the backbeat_travel_document_* functions and the
// private bucket. Migration 009 gives this role no table privilege on the document tables.
// A static test (tests/unit/travel-documents-static.test.ts) enforces the import boundary.

/** Server flag, default off. Off = no upload, no download, no privileged client. */
export function travelDocumentScansEnabled(): boolean {
  return process.env.TRAVEL_DOC_SCANS_ENABLED === "true"
}

/** null when the flag is off or the server credential is not configured. */
export function createPrivilegedClient(): SupabaseClient | null {
  if (typeof window !== "undefined") throw new Error("Privileged client is server-only")
  if (!travelDocumentScansEnabled()) return null
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!key) return null
  const { url } = getSupabaseEnvironment()
  return createSupabaseClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
}
