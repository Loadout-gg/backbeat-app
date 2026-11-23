"use client"

import { useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { createEventFromBooking, type BookingEventLink as LinkedEvent } from "@/lib/actions/booking-events"
import { BOOKING_EVENT_COPY, canConvertBookingToEvent } from "@/lib/booking-event"

interface BookingEventLinkProps {
  bookingId: string
  /** Stored booking status (server copy), never a local draft. */
  status: string
  /** The event already created from this booking; null = none; "unavailable" = that read failed. */
  linkedEvent: LinkedEvent | null | "unavailable"
}

const linkClass = "font-medium text-foreground underline underline-offset-4 [overflow-wrap:anywhere]"

/**
 * "Create event" for a confirmed or completed booking, and the link to the event once it
 * exists. One event per booking: the database refuses a second one, and a refused retry
 * shows fixed copy with a link to the existing event. Creating the event never changes the
 * booking status.
 */
export function BookingEventLink({ bookingId, status, linkedEvent }: BookingEventLinkProps) {
  const router = useRouter()
  const inFlight = useRef(false)
  const [isCreating, setIsCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [existingEventId, setExistingEventId] = useState<string | null>(null)
  const [createdEventId, setCreatedEventId] = useState<string | null>(null)

  const stored = linkedEvent !== null && linkedEvent !== "unavailable" ? linkedEvent : null
  const eventId = stored?.id ?? createdEventId
  const convertible = canConvertBookingToEvent(status)

  const handleCreate = async () => {
    if (inFlight.current) return
    inFlight.current = true
    setIsCreating(true)
    setError(null)
    setExistingEventId(null)
    try {
      const result = await createEventFromBooking(bookingId)
      if (result.success) {
        setCreatedEventId(result.eventId)
        router.refresh()
      } else {
        setError(result.error)
        setExistingEventId(result.existingEventId ?? null)
      }
    } catch {
      setError(BOOKING_EVENT_COPY.unconfirmed)
    } finally {
      inFlight.current = false
      setIsCreating(false)
    }
  }

  return (
    <section aria-labelledby="booking-event-heading" className="space-y-3 border-b border-border px-4 py-4 sm:px-6">
      <h2 id="booking-event-heading" className="text-base font-medium text-foreground">Event</h2>
      {eventId ? (
        <p role="status" className="text-sm text-foreground">
          {stored ? "Event created from this booking: " : "Event created. "}
          <Link href={`/dashboard/events/${eventId}`} className={linkClass}>
            {stored ? stored.title : "Open event"}
          </Link>
        </p>
      ) : (
        <>
          {linkedEvent === "unavailable" && (
            <p role="alert" className="text-sm text-destructive">
              The event of this booking could not be checked. Reload the page before creating one.
            </p>
          )}
          <p id="booking-event-help" className="text-sm text-muted-foreground">
            {convertible
              ? "Creates one event from the saved booking: artist, venue, date, start time, promoter and fee. The booking status does not change. Save your edits first."
              : "Available when the booking is confirmed or completed."}
          </p>
          <Button
            type="button"
            size="sm"
            onClick={handleCreate}
            disabled={!convertible || linkedEvent === "unavailable"}
            aria-disabled={isCreating}
            aria-describedby="booking-event-help"
            className="h-auto min-h-9 whitespace-normal aria-disabled:cursor-wait aria-disabled:opacity-50"
          >
            {isCreating ? "Creating event..." : "Create event"}
          </Button>
        </>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
          {existingEventId && (
            <>
              {" "}
              <Link href={`/dashboard/events/${existingEventId}`} className={linkClass}>Open the existing event</Link>
            </>
          )}
        </p>
      )}
    </section>
  )
}
