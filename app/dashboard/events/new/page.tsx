"use client"

import type React from "react"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { createEvent, listPromoters, type Promoter } from "@/lib/actions/events"
import { listArtists, type Artist } from "@/lib/actions/artists"

export default function NewEventPage() {
  const router = useRouter()
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [artists, setArtists] = useState<Artist[]>([])
  const [promoters, setPromoters] = useState<Promoter[]>([])
  const [selectedArtist, setSelectedArtist] = useState<string>("none")
  const [selectedPromoter, setSelectedPromoter] = useState<string>("none")
  const [selectedStatus, setSelectedStatus] = useState<string>("in_progress")

  useEffect(() => {
    async function loadData() {
      const [artistsData, promotersData] = await Promise.all([listArtists(), listPromoters()])
      setArtists(artistsData)
      setPromoters(promotersData)
    }
    loadData()
  }, [])

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setIsLoading(true)
    setError(null)

    const formData = new FormData(e.currentTarget)
    const title = formData.get("title") as string
    const date = formData.get("date") as string
    const location = formData.get("location") as string

    const result = await createEvent({
      title,
      date,
      location: location || undefined,
      status: selectedStatus as "in_progress" | "confirmed" | "cancelled",
      artist_id: selectedArtist === "none" ? undefined : selectedArtist,
      promoter_id: selectedPromoter === "none" ? undefined : selectedPromoter,
    })

    if (result.success) {
      router.push("/dashboard/events")
    } else {
      setError(result.error || "Failed to create event")
      setIsLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/dashboard/events">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-semibold">New event</h1>
          <p className="text-sm text-muted-foreground">Create a new booking or performance</p>
        </div>
      </div>

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>Event details</CardTitle>
          <CardDescription>Enter the basic information for this event.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="p-3 text-sm text-red-500 bg-red-50 border border-red-200 rounded-md">{error}</div>
            )}

            <div className="space-y-2">
              <Label htmlFor="title">Title *</Label>
              <Input id="title" name="title" placeholder="Event title" required disabled={isLoading} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="date">Date *</Label>
              <Input id="date" name="date" type="date" required disabled={isLoading} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="location">Location</Label>
              <Input id="location" name="location" placeholder="Venue or city" disabled={isLoading} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="status">Status</Label>
              <Select value={selectedStatus} onValueChange={setSelectedStatus} disabled={isLoading}>
                <SelectTrigger>
                  <SelectValue placeholder="Select status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="in_progress">In Progress</SelectItem>
                  <SelectItem value="confirmed">Confirmed</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="artist">Artist</Label>
              <Select value={selectedArtist} onValueChange={setSelectedArtist} disabled={isLoading}>
                <SelectTrigger>
                  <SelectValue placeholder="Select artist (optional)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {artists.map((artist) => (
                    <SelectItem key={artist.id} value={artist.id}>
                      {artist.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="promoter">Promoter</Label>
              <Select value={selectedPromoter} onValueChange={setSelectedPromoter} disabled={isLoading}>
                <SelectTrigger>
                  <SelectValue placeholder="Select promoter (optional)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {promoters.map((promoter) => (
                    <SelectItem key={promoter.id} value={promoter.id}>
                      {promoter.company_name ? `${promoter.name} (${promoter.company_name})` : promoter.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex gap-3 pt-4">
              <Button type="submit" disabled={isLoading}>
                {isLoading ? "Creating..." : "Create event"}
              </Button>
              <Button type="button" variant="outline" asChild>
                <Link href="/dashboard/events">Cancel</Link>
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
