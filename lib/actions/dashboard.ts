"use server"

import { createClient } from "@/lib/supabase/server"
import { getCurrentWorkspaceId } from "./workspace"

export type DashboardStats = {
  totalArtists: number
  totalEvents: number
  totalBookingsInProgress: number
  totalPromoters: number
}

export async function getDashboardStats(): Promise<DashboardStats> {
  const supabase = await createClient()
  const workspaceId = await getCurrentWorkspaceId()

  // Run all queries in parallel for better performance
  const [artistsResult, eventsResult, bookingsInProgressResult, promotersResult] = await Promise.all([
    supabase.from("artists").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId),
    supabase.from("events").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId),
    supabase
      .from("events")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .eq("status", "in_progress"),
    supabase.from("promoters").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId),
  ])

  return {
    totalArtists: artistsResult.count ?? 0,
    totalEvents: eventsResult.count ?? 0,
    totalBookingsInProgress: bookingsInProgressResult.count ?? 0,
    totalPromoters: promotersResult.count ?? 0,
  }
}
