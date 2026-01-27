import { notFound } from "next/navigation"
import { getArtist } from "@/lib/actions/artists"
import { ArtistProfileClient } from "./artist-profile-client"

interface ArtistPageProps {
  params: Promise<{ id: string }>
}

export default async function ArtistPage({ params }: ArtistPageProps) {
  const { id } = await params

  const artist = await getArtist(id)

  if (!artist) {
    notFound()
  }

  return <ArtistProfileClient artist={artist} />
}
