"use client"

import { useState, type FormEvent } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { updateEvent, type EventDetail, type EventUpdateInput, type PromoterOption } from "@/lib/actions/events"
import { BOOKING_FEE_CURRENCIES, formatBookingFeeInput, parseBookingFee } from "@/lib/booking-fee"
import { BOOKING_EVENT_COPY } from "@/lib/booking-event"
import { DeleteEvent } from "./delete-event"

type Option = { id: string; label: string }
const STATUSES = [
  { value: "in_progress", label: "In progress" },
  { value: "confirmed", label: "Confirmed" },
  { value: "cancelled", label: "Cancelled" },
] as const
const UNCONFIRMED = "Unable to confirm whether the event was saved. Check the event list before retrying."

/** The event's saved promoter: a directory entry, none, or a link whose entry is no longer listed. */
export type LinkedPromoter = PromoterOption | null | "missing"

function EventPromoterCard({ promoter }: { promoter: LinkedPromoter }) {
  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <h2 className="leading-none font-semibold">Promoter</h2>
        <CardDescription>The promoter saved on this event, from your promoter directory.</CardDescription>
      </CardHeader>
      <CardContent className="[overflow-wrap:anywhere]">
        {promoter === null ? (
          <p className="text-sm text-muted-foreground">No promoter is linked to this event.</p>
        ) : promoter === "missing" ? (
          <p className="text-sm text-muted-foreground">The linked promoter is no longer in your promoter directory.</p>
        ) : (
          <dl className="space-y-3 text-sm">
            <div>
              <dt className="text-muted-foreground">Person</dt>
              <dd className="font-medium">
                <Link
                  href={`/dashboard/promoters/${promoter.id}/edit`}
                  aria-label={`Open ${promoter.name} in the promoter directory`}
                  className="rounded-sm underline underline-offset-4 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  {promoter.name}
                </Link>
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Company</dt>
              <dd>{promoter.company_name ?? "No company recorded"}</dd>
            </div>
          </dl>
        )}
      </CardContent>
    </Card>
  )
}

export function EventEditClient({ event, bookingStatus = null, linkedPromoter, artists, promoters }: {
  event: EventDetail
  /** Stored status of the booking this event was created from; null = none or not found; "unavailable" = read failed. */
  bookingStatus?: string | null | "unavailable"
  linkedPromoter: LinkedPromoter; artists: Option[]; promoters: Option[]
}) {
  const router = useRouter()
  const [title, setTitle] = useState(event.title)
  const [date, setDate] = useState(event.date)
  const [location, setLocation] = useState(event.location ?? "")
  const [status, setStatus] = useState(event.status)
  const [artistId, setArtistId] = useState(event.artist_id ?? "none")
  const [promoterId, setPromoterId] = useState(event.promoter_id ?? "none")
  // Start time and fee (migration 008) are sent only when edited, so an untouched field is never rewritten.
  const savedStartTime = event.start_time ? event.start_time.slice(0, 5) : ""
  const [startTime, setStartTime] = useState(savedStartTime)
  const [feeAmount, setFeeAmount] = useState(() => formatBookingFeeInput(event.fee_amount_minor ?? null, event.fee_currency ?? null))
  const [feeCurrency, setFeeCurrency] = useState<string>(event.fee_currency ?? "")
  const [feeDirty, setFeeDirty] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const knownStatus = STATUSES.some(item => item.value === status)
  // The event of a cancelled booking stays cancelled (008 BB010): the status is shown read-only.
  const statusLocked = event.booking_id !== null && bookingStatus === "cancelled"

  async function handleSubmit(submitEvent: FormEvent<HTMLFormElement>) {
    submitEvent.preventDefault()
    if (isSaving) return
    if (!title.trim()) { setError("Event title is required"); return }
    if (!date) { setError("Enter a valid event date"); return }
    if (!knownStatus) { setError("Choose a valid status"); return }
    if (startTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime)) { setError("Enter a valid start time"); return }
    const fee = parseBookingFee(feeAmount, feeCurrency)
    if (feeDirty && !fee.success) { setError(fee.error.replace("Booking fee", "Fee").replace("booking fee", "fee")); return }
    setError(null)
    setIsSaving(true)
    try {
      const result = await updateEvent(event.id, {
        title, date, location: location || null,
        status: status as EventUpdateInput["status"],
        artist_id: artistId === "none" ? null : artistId,
        promoter_id: promoterId === "none" ? null : promoterId,
        ...(startTime !== savedStartTime ? { start_time: startTime || null } : {}),
        ...(feeDirty && fee.success ? fee.data : {}),
      })
      if (result.success) {
        router.push("/dashboard/events")
        return
      }
      setError(result.error)
    } catch {
      setError(UNCONFIRMED)
    }
    setIsSaving(false)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/dashboard/events" aria-label="Back to events">
            <ArrowLeft aria-hidden="true" className="h-4 w-4" />
          </Link>
        </Button>
        <div className="min-w-0 [overflow-wrap:anywhere]">
          <h1 className="text-2xl font-semibold">{event.title}</h1>
          <p className="text-sm text-muted-foreground">View and edit this event</p>
        </div>
      </div>

      {event.booking_id && (
        <p className="max-w-2xl text-sm text-muted-foreground">
          Created from a booking.{" "}
          <Link href={`/dashboard/bookings/${event.booking_id}`} className="font-medium text-foreground underline underline-offset-4">
            Open booking
          </Link>
        </p>
      )}
      <EventPromoterCard promoter={linkedPromoter} />

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>Event details</CardTitle>
          <CardDescription>Title and date are required.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} noValidate className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="event-title">Title *</Label>
              <Input id="event-title" value={title} onChange={(e) => setTitle(e.target.value)} required disabled={isSaving} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="event-date">Date *</Label>
              <Input id="event-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required disabled={isSaving} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="event-start-time">Start time</Label>
              <Input id="event-start-time" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} disabled={isSaving} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="event-location">Location</Label>
              <Input id="event-location" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Venue or city" disabled={isSaving} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="event-status">Status</Label>
              <Select value={status} onValueChange={(value) => { if (value && !statusLocked) setStatus(value) }} disabled={isSaving || statusLocked}>
                <SelectTrigger id="event-status" aria-describedby={statusLocked ? "event-status-locked" : undefined}><SelectValue placeholder="Select status" /></SelectTrigger>
                <SelectContent>
                  {STATUSES.map(item => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
                  {!knownStatus && <SelectItem value={status} disabled>{status} (not supported)</SelectItem>}
                </SelectContent>
              </Select>
              {statusLocked && (
                <p id="event-status-locked" className="text-sm text-muted-foreground">{BOOKING_EVENT_COPY.eventStatusLocked}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="event-artist">Artist</Label>
              <Select value={artistId} onValueChange={(value) => { if (value) setArtistId(value) }} disabled={isSaving}>
                <SelectTrigger id="event-artist"><SelectValue placeholder="Select artist (optional)" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {artists.map(artist => <SelectItem key={artist.id} value={artist.id}>{artist.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="event-promoter">Promoter</Label>
              <Select value={promoterId} onValueChange={(value) => { if (value) setPromoterId(value) }} disabled={isSaving}>
                <SelectTrigger id="event-promoter"><SelectValue placeholder="Select promoter (optional)" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {promoters.map(promoter => <SelectItem key={promoter.id} value={promoter.id}>{promoter.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="event-fee-amount">Fee amount</Label>
                <Input
                  id="event-fee-amount" type="text" inputMode="decimal" autoComplete="off" value={feeAmount}
                  onChange={(e) => { setFeeAmount(e.target.value); setFeeDirty(true) }}
                  disabled={isSaving} aria-describedby="event-fee-help"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="event-fee-currency">Fee currency</Label>
                <select
                  id="event-fee-currency" value={feeCurrency}
                  onChange={(e) => { setFeeCurrency(e.target.value); setFeeDirty(true) }}
                  disabled={isSaving} aria-describedby="event-fee-help"
                  className="h-9 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                >
                  <option value="">Not specified</option>
                  {BOOKING_FEE_CURRENCIES.map(currency => <option key={currency} value={currency}>{currency}</option>)}
                </select>
              </div>
              <p id="event-fee-help" className="text-sm text-muted-foreground sm:col-span-2">
                {event.booking_id
                  ? "Copied from the booking when the event was created. Editing it here does not change the booking."
                  : "Optional."}{" "}
                Clear both fields to remove the fee. No grouping separators; JPY uses whole numbers.
              </p>
            </div>
            {/* Next to Save, so a refusal is visible where the user clicked (owner E2E 2026-11-27). */}
            {error && (
              <div role="alert" className="rounded-md border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
            )}
            <div className="flex flex-wrap gap-3 pt-4">
              <Button type="submit" disabled={isSaving}>{isSaving ? "Saving..." : "Save changes"}</Button>
              <Button type="button" variant="outline" asChild><Link href="/dashboard/events">Cancel</Link></Button>
            </div>
          </form>
        </CardContent>
      </Card>
      {event.booking_id ? (
        // An event created from a booking follows it and is kept as history: never deleted.
        <Card className="max-w-2xl">
          <CardHeader>
            <CardTitle>Delete event</CardTitle>
            <CardDescription>{BOOKING_EVENT_COPY.eventFromBookingNotice}</CardDescription>
          </CardHeader>
          <CardContent>
            <Link href={`/dashboard/bookings/${event.booking_id}`} className="text-sm font-medium text-foreground underline underline-offset-4">
              Open the booking to cancel it
            </Link>
          </CardContent>
        </Card>
      ) : (
        <DeleteEvent id={event.id} title={event.title} />
      )}
    </div>
  )
}
