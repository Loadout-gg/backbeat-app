import { notFound, unstable_rethrow } from "next/navigation"
import { getArtist } from "@/lib/actions/artists"
import { getArtistTravelProfile, type ArtistTravelProfile } from "@/lib/actions/artist-travel-documents"
import { ArtistTravelDocumentsSection } from "@/components/dashboard/artist-travel-documents-section"
import { getBookings } from "@/lib/actions/bookings"
import { listEvents } from "@/lib/actions/events"
import { ArtistProfileClient } from "./artist-profile-client"
import { configuredCalendarDay } from "@/lib/calendar-day"

interface ArtistPageProps {
  params: Promise<{ id: string }>
}

export default async function ArtistPage({ params }: ArtistPageProps) {
  const { id } = await params

  const artist = await getArtist(id)

  if (!artist) {
    notFound()
  }

  let bookings: Awaited<ReturnType<typeof getBookings>> = []
  let events: Awaited<ReturnType<typeof listEvents>> = []
  let calendarError = false
  try {
    const results = await Promise.all([
      getBookings({ artistId: id, failOnError: true }),
      listEvents({ artistId: id }),
    ])
    bookings = results[0].filter((booking) => booking.artist_id === id)
    events = results[1].filter((event) => event.artist_id === id)
  } catch (error) {
    unstable_rethrow(error)
    calendarError = true
  }

  const calendarToday = configuredCalendarDay()

  // Sensitive travel documents: separate explicit read, null renders an unavailable state.
  let travelProfile: ArtistTravelProfile | null = null
  try {
    travelProfile = await getArtistTravelProfile(id)
  } catch (error) {
    unstable_rethrow(error)
  }

  return (
    <ArtistProfileClient
      artist={artist}
      bookings={bookings}
      events={events}
      calendarError={calendarError}
      calendarToday={calendarToday}
      travelDocuments={<ArtistTravelDocumentsSection artistId={artist.id} profile={travelProfile} today={calendarToday} />}
    />
  )
}
