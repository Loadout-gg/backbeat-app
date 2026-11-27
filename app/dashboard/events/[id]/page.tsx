import { notFound, unstable_rethrow } from "next/navigation"
import { RetryButton } from "@/components/retry-button"
import { getArtists, type ArtistOption } from "@/lib/actions/artists"
import { getEvent, listPromoters, type PromoterOption } from "@/lib/actions/events"
import { EventEditClient } from "./event-edit-client"

export default async function EventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const event = await getEvent(id)
  if (!event) notFound()

  let artists: ArtistOption[] = []
  let promoters: PromoterOption[] = []
  let optionsError = false
  try {
    ;[artists, promoters] = await Promise.all([getArtists(), listPromoters()])
  } catch (error) {
    unstable_rethrow(error)
    optionsError = true
  }

  if (optionsError) {
    return (
      <div className="space-y-3">
        <h1 className="text-2xl font-semibold">{event.title}</h1>
        <p role="alert" className="text-sm text-destructive">Unable to load the artist and promoter options. Please refresh and try again.</p>
        <RetryButton label="Retry loading event" />
      </div>
    )
  }

  // The saved link only, from the promoter directory; a booking's contact is never used here.
  const linkedPromoter = event.promoter_id === null
    ? null
    : promoters.find(promoter => promoter.id === event.promoter_id) ?? "missing"

  return (
    <EventEditClient
      event={event}
      linkedPromoter={linkedPromoter === null || linkedPromoter === "missing"
        ? linkedPromoter
        : { id: linkedPromoter.id, name: linkedPromoter.name, company_name: linkedPromoter.company_name }}
      artists={artists.map(artist => ({ id: artist.id, label: artist.stage_name }))}
      promoters={promoters.map(promoter => ({
        id: promoter.id,
        label: promoter.company_name ? `${promoter.name} (${promoter.company_name})` : promoter.name,
      }))}
    />
  )
}
