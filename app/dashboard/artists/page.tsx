import { unstable_rethrow } from "next/navigation"
import { listArtistDirectory } from "@/lib/actions/artist-directory"
import type { ArtistDirectoryEntry } from "@/lib/artist-list"
import ArtistsListClient from "./artists-list-client"

export default async function ArtistsPage() {
  let artists: ArtistDirectoryEntry[] = []
  let loadError = false
  try {
    artists = await listArtistDirectory()
  } catch (error) {
    // Redirects (e.g. onboarding) propagate; a failed read is shown as such, never as an empty roster.
    unstable_rethrow(error)
    loadError = true
  }
  return <ArtistsListClient artists={artists} loadError={loadError} />
}
