import { listArtistDirectory } from "@/lib/actions/artist-directory"
import ArtistsListClient from "./artists-list-client"

export default async function ArtistsPage() {
  return <ArtistsListClient artists={await listArtistDirectory()} />
}
