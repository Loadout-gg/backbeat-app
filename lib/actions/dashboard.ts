"use server"

import { createClient } from "@/lib/supabase/server"
import { getCurrentWorkspaceId } from "./workspace"

export type DashboardStats = {
  totalArtists: number
  eventsInProgress: number
  bookingsInProgress: number
  totalPromoters: number
}

function checkedCount(result: {
  count: number | null
  error: { message: string } | null
}): number {
  if (
    result.error ||
    result.count === null ||
    !Number.isSafeInteger(result.count) ||
    result.count < 0
  ) {
    throw new Error("Unable to load dashboard counts. Please try again.")
  }
  return result.count
}

export async function getDashboardStats(): Promise<DashboardStats> {
  const supabase = await createClient()
  const workspaceId = await getCurrentWorkspaceId()

  const [artists, events, promoters] = await Promise.all([
    supabase
      .from("artists")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId),
    supabase
      .from("events")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .eq("status", "in_progress"),
    supabase
      .from("promoters")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId),
  ])

  return {
    totalArtists: checkedCount(artists),
    eventsInProgress: checkedCount(events),
    // Compatibility field; the UI derives its booking count from the complete list.
    bookingsInProgress: 0,
    totalPromoters: checkedCount(promoters),
  }
}
