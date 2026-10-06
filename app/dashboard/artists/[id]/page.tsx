import { notFound } from "next/navigation"
import { getArtist } from "@/lib/actions/artists"
import { getBookings } from "@/lib/actions/bookings"
import { listEvents } from "@/lib/actions/events"
import { ArtistProfileClient } from "./artist-profile-client"
import { calendarDay } from "@/lib/calendar-day"

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
  } catch {
    calendarError = true
  }

  const calendarToday = calendarDay(new Date(), process.env.BACKBEAT_CALENDAR_TIME_ZONE ?? "UTC")

  return (
    <ArtistProfileClient
      artist={artist}
      bookings={bookings}
      events={events}
      calendarError={calendarError}
      calendarToday={calendarToday}
    />
  )
}
