"use server"

import { createClient } from "@/lib/supabase/server"
import { getCurrentWorkspaceId } from "./workspace"

export type DashboardStats = {
  totalArtists: number
  eventsInProgress: number
  bookingsInProgress: number
  totalPromoters: number
}

export async function getDashboardStats(): Promise<DashboardStats> {
  const supabase = await createClient()
  const workspaceId = await getCurrentWorkspaceId()

  // Query real data from existing tables
  // Artists and promoters tables exist; events/bookings will return 0 if tables don't exist or are empty
  const [artistsResult, eventsResult, promotersResult] = await Promise.all([
    supabase.from("artists").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId),
    supabase
      .from("events")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .eq("status", "in_progress"),
    supabase.from("promoters").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId),
  ])

  return {
    totalArtists: artistsResult.count ?? 0,
    eventsInProgress: eventsResult.count ?? 0,
    bookingsInProgress: 0, // Bookings table doesn't exist yet
    totalPromoters: promotersResult.count ?? 0,
  }
}
