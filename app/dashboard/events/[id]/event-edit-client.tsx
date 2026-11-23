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
import { updateEvent, type EventDetail, type EventUpdateInput } from "@/lib/actions/events"
import { DeleteEvent } from "./delete-event"

type Option = { id: string; label: string }
const STATUSES = [
  { value: "in_progress", label: "In progress" },
  { value: "confirmed", label: "Confirmed" },
  { value: "cancelled", label: "Cancelled" },
] as const
const UNCONFIRMED = "Unable to confirm whether the event was saved. Check the event list before retrying."

export function EventEditClient({ event, artists, promoters }: { event: EventDetail; artists: Option[]; promoters: Option[] }) {
  const router = useRouter()
  const [title, setTitle] = useState(event.title)
  const [date, setDate] = useState(event.date)
  const [location, setLocation] = useState(event.location ?? "")
  const [status, setStatus] = useState(event.status)
  const [artistId, setArtistId] = useState(event.artist_id ?? "none")
  const [promoterId, setPromoterId] = useState(event.promoter_id ?? "none")
  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const knownStatus = STATUSES.some(item => item.value === status)

  async function handleSubmit(submitEvent: FormEvent<HTMLFormElement>) {
    submitEvent.preventDefault()
    if (isSaving) return
    if (!title.trim()) { setError("Event title is required"); return }
    if (!date) { setError("Enter a valid event date"); return }
    if (!knownStatus) { setError("Choose a valid status"); return }
    setError(null)
    setIsSaving(true)
    try {
      const result = await updateEvent(event.id, {
        title, date, location: location || null,
        status: status as EventUpdateInput["status"],
        artist_id: artistId === "none" ? null : artistId,
        promoter_id: promoterId === "none" ? null : promoterId,
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

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>Event details</CardTitle>
          <CardDescription>Title and date are required.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} noValidate className="space-y-4">
            {error && (
              <div role="alert" className="rounded-md border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
            )}
            <div className="space-y-2">
              <Label htmlFor="event-title">Title *</Label>
              <Input id="event-title" value={title} onChange={(e) => setTitle(e.target.value)} required disabled={isSaving} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="event-date">Date *</Label>
              <Input id="event-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required disabled={isSaving} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="event-location">Location</Label>
              <Input id="event-location" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Venue or city" disabled={isSaving} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="event-status">Status</Label>
              <Select value={status} onValueChange={(value) => { if (value) setStatus(value) }} disabled={isSaving}>
                <SelectTrigger id="event-status"><SelectValue placeholder="Select status" /></SelectTrigger>
                <SelectContent>
                  {STATUSES.map(item => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
                  {!knownStatus && <SelectItem value={status} disabled>{status} (not supported)</SelectItem>}
                </SelectContent>
              </Select>
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
            <div className="flex flex-wrap gap-3 pt-4">
              <Button type="submit" disabled={isSaving}>{isSaving ? "Saving..." : "Save changes"}</Button>
              <Button type="button" variant="outline" asChild><Link href="/dashboard/events">Cancel</Link></Button>
            </div>
          </form>
        </CardContent>
      </Card>
      <DeleteEvent id={event.id} title={event.title} />
    </div>
  )
}
