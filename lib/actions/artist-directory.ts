"use server"
import { createClient } from "@/lib/supabase/server"
import { getCurrentWorkspaceId } from "./workspace"
import type { ArtistDirectoryEntry } from "@/lib/artist-list"

const BATCH_SIZE = 200
const DIRECTORY_COLUMNS = "id,name,surname,stage_name,genres,location,fee,currency"

export async function listArtistDirectory(): Promise<ArtistDirectoryEntry[]> {
  const supabase = await createClient()
  const workspaceId = await getCurrentWorkspaceId()
  const result: ArtistDirectoryEntry[] = []
  const ids = new Set<string>()
  let expectedCount: number | undefined
  while (true) {
    const { data, error, count } = await supabase.from("artists")
      .select(DIRECTORY_COLUMNS, { count: "exact" })
      .eq("workspace_id", workspaceId).order("id", { ascending: true }).range(result.length, result.length + BATCH_SIZE - 1)
    if (error) throw new Error(error.message)
    if (count === null || !Number.isSafeInteger(count) || count < 0) throw new Error("Invalid artist directory count")
    if (expectedCount !== undefined && count !== expectedCount) throw new Error("Artist directory count changed")
    expectedCount = count
    if (!data || (data.length === 0 && result.length < count)) throw new Error("Artist directory incomplete")
    if (data.length > BATCH_SIZE || result.length + data.length > count) throw new Error("Artist directory inconsistent row count")
    for (const artist of data) {
      if (!artist || typeof artist.id !== "string" || !artist.id.trim()
        || [artist.name, artist.surname, artist.stage_name, artist.location, artist.currency]
          .some((value) => value != null && typeof value !== "string")
        || (artist.genres != null && (!Array.isArray(artist.genres) || artist.genres.some((genre: unknown) => typeof genre !== "string")))
        || (artist.fee != null && (typeof artist.fee !== "number" || !Number.isFinite(artist.fee)))) {
        throw new Error("Invalid artist directory row")
      }
      if (ids.has(artist.id)) throw new Error("Artist directory duplicate ID")
      ids.add(artist.id)
    }
    // Explicit projection is the client privacy boundary; never spread database rows.
    result.push(...data.map((artist) => ({
      id: artist.id,
      name: artist.name ?? null,
      surname: artist.surname ?? null,
      stage_name: artist.stage_name ?? null,
      genres: artist.genres ?? [],
      location: artist.location ?? null,
      fee: artist.fee ?? null,
      currency: artist.currency ?? null,
    })))
    if (result.length === count) return result
  }
}
