"use server"

import { unstable_rethrow } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { getCurrentWorkspaceId } from "./workspace"
import { readCompleteCollection } from "@/lib/read-complete-collection"
import { configuredCalendarDay } from "@/lib/calendar-day"
import { ARTIST_EXPORT_ERROR, ARTIST_EXPORT_SELECT, artistsCsvFileName, buildArtistsCsv, isArtistExportRow, type ArtistExportRow } from "@/lib/artist-csv"

export type ArtistsCsvExport =
  | { success: true; csv: string; fileName: string; count: number }
  | { success: false; error: string }

/** Complete, workspace-scoped artist export. Failures return fixed copy, never the provider message. */
export async function exportArtistsCsv(): Promise<ArtistsCsvExport> {
  try {
    const supabase = await createClient()
    const workspaceId = await getCurrentWorkspaceId()
    const rows = await readCompleteCollection<ArtistExportRow>(async (from, to) => {
      const { data, error, count } = await supabase.from("artists")
        .select(ARTIST_EXPORT_SELECT, { count: "exact" })
        .eq("workspace_id", workspaceId)
        .order("id", { ascending: true })
        .range(from, to)
      return { data: data as unknown as ArtistExportRow[] | null, error, count }
    }, "Artist export")
    if (!rows.every(isArtistExportRow)) throw new Error("Artist export: invalid row")
    return { success: true, csv: buildArtistsCsv(rows), fileName: artistsCsvFileName(configuredCalendarDay()), count: rows.length }
  } catch (error) {
    // Let the onboarding/auth redirects of getCurrentWorkspaceId propagate.
    unstable_rethrow(error)
    return { success: false, error: ARTIST_EXPORT_ERROR }
  }
}
