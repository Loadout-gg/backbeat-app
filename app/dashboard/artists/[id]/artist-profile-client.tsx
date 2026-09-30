"use client"

import { useEffect, useState, useCallback } from "react"
import { useSearchParams, useRouter, usePathname } from "next/navigation"
import Link from "next/link"
import { parseISO } from "date-fns"
import type { Booking } from "@/lib/actions/bookings"
import type { EventWithRelations } from "@/lib/actions/events"
import {
  ChevronRight,
  ChevronLeft,
  Edit,
  MessageSquare,
  Plus,
  FileText,
  Trash2,
  Upload,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Calendar } from "@/components/ui/calendar"
import { type Artist, type SocialLink } from "@/lib/actions/artists"
import { NewBookingModal } from "@/components/dashboard/new-booking-modal"
import { formatArtistBaseRate } from "@/lib/artist-base-rate"

// Social icon mapping
function getSocialIcon(type: string) {
  const t = type.toLowerCase()
  if (t.includes("instagram")) return "IG"
  if (t.includes("facebook")) return "F"
  if (t.includes("twitter") || t.includes("x")) return "X"
  if (t.includes("soundcloud")) return "SC"
  if (t.includes("spotify")) return "SP"
  if (t.includes("youtube")) return "YT"
  if (t.includes("tiktok")) return "TT"
  if (t.includes("website") || t.includes("web")) return "W"
  return "CN"
}

// Parse social links safely
function parseSocialLinks(socialLinks: unknown): SocialLink[] {
  if (!socialLinks) return []

  if (Array.isArray(socialLinks)) {
    return socialLinks.filter(
      (link): link is SocialLink =>
        typeof link === "object" && link !== null && "type" in link && "url" in link
    )
  }

  if (typeof socialLinks === "string") {
    try {
      const parsed = JSON.parse(socialLinks)
      if (Array.isArray(parsed)) {
        return parsed.filter(
          (link): link is SocialLink =>
            typeof link === "object" && link !== null && "type" in link && "url" in link
        )
      }
    } catch {
      return []
    }
  }

  return []
}

// Document type
type Document = {
  name: string
  url?: string
  type?: string
}

// Parse documents safely (handles JSON string or array)
function parseDocuments(documents: unknown): Document[] {
  if (!documents) return []

  if (Array.isArray(documents)) {
    return documents.filter(
      (doc): doc is Document =>
        typeof doc === "object" && doc !== null && "name" in doc
    )
  }

  if (typeof documents === "string") {
    try {
      const parsed = JSON.parse(documents)
      if (Array.isArray(parsed)) {
        return parsed.filter(
          (doc): doc is Document =>
            typeof doc === "object" && doc !== null && "name" in doc
        )
      }
    } catch {
      return []
    }
  }

  return []
}

// Ensure URL has scheme
function ensureScheme(url: string): string {
  if (!url) return "#"
  if (url.startsWith("http://") || url.startsWith("https://")) return url
  return `https://${url}`
}

// Format equipment as list items
function formatEquipmentList(text: string | null): string[] {
  if (!text) return []
  return text.split("\n").filter((line) => line.trim())
}

// Valid tab values
const VALID_TABS = ["overview", "calendar", "documents", "special"] as const
type TabValue = (typeof VALID_TABS)[number]

function isValidTab(tab: string | null): tab is TabValue {
  return tab !== null && VALID_TABS.includes(tab as TabValue)
}

interface ArtistProfileClientProps {
  artist: Artist
  bookings: Booking[]
  events: EventWithRelations[]
  calendarError?: boolean
  calendarToday: string
}

export function ArtistProfileClient({ artist, bookings, events, calendarError = false, calendarToday }: ArtistProfileClientProps) {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const [showUpdatedToast, setShowUpdatedToast] = useState(false)
  const [calendarMonth, setCalendarMonth] = useState(() => parseISO(calendarToday))
  const [isBookingModalOpen, setIsBookingModalOpen] = useState(false)

  // Get current tab from URL or default to overview
  const tabParam = searchParams.get("tab")
  const currentTab: TabValue = isValidTab(tabParam) ? tabParam : "overview"

  // Handle tab change with URL update
  const handleTabChange = useCallback(
    (value: string) => {
      const params = new URLSearchParams(searchParams.toString())
      params.set("tab", value)
      router.push(`${pathname}?${params.toString()}`, { scroll: false })
    },
    [searchParams, router, pathname]
  )

  useEffect(() => {
    if (searchParams.get("updated") === "1") {
      // The URL is an external navigation signal; consume it once and retain the timed toast.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setShowUpdatedToast(true)
      const timer = setTimeout(() => setShowUpdatedToast(false), 3000)
      // Clear updated param but keep tab
      const params = new URLSearchParams(searchParams.toString())
      params.delete("updated")
      const newUrl = params.toString()
        ? `${pathname}?${params.toString()}`
        : pathname
      window.history.replaceState({}, "", newUrl)
      return () => clearTimeout(timer)
    }
  }, [searchParams, pathname])

  const displayName = artist.stage_name || artist.name || "Unknown Artist"
  const realName = artist.surname
    ? `${artist.name || ""} ${artist.surname}`.trim()
    : artist.name !== artist.stage_name
      ? artist.name
      : null

  const socialLinks = parseSocialLinks(artist.social_links)
  const djEquipmentList = formatEquipmentList(artist.dj_equipment)
  const soundSystemList = formatEquipmentList(artist.sound_system)
  const documents = parseDocuments(artist.documents)

  // Extract contact name from notes if available
  const contactName = artist.notes?.startsWith("Contact: ")
    ? artist.notes.replace("Contact: ", "").split("\n")[0]
    : null

  // One server-selected date-only reference is shared with hydration and the day picker.
  const today = parseISO(calendarToday)
  const isUpcomingActive = (item: Booking | EventWithRelations) =>
    item.artist_id === artist.id &&
    (item.status === "in_progress" || item.status === "confirmed") &&
    parseISO(item.date) >= today

  const calendarEvents = [
    ...bookings.filter(isUpcomingActive).map((booking) => ({
      id: `booking-${booking.id}`, date: parseISO(booking.date),
      title: `${displayName} · Booking`, location: "", time: booking.start_time,
      href: `/dashboard/bookings/${booking.id}`,
    })),
    ...events.filter(isUpcomingActive).map((event) => ({
      id: `event-${event.id}`, date: parseISO(event.date), title: event.title,
      location: event.location || "", time: "", href: null,
    })),
  ].sort((a, b) => a.date.getTime() - b.date.getTime() || a.time.localeCompare(b.time))
  const hasCalendarItems = calendarEvents.length > 0

  // Navigate calendar months
  const handlePreviousMonth = () => {
    setCalendarMonth((prev) => {
      const newDate = new Date(prev)
      newDate.setMonth(newDate.getMonth() - 1)
      return newDate
    })
  }

  const handleNextMonth = () => {
    setCalendarMonth((prev) => {
      const newDate = new Date(prev)
      newDate.setMonth(newDate.getMonth() + 1)
      return newDate
    })
  }

  const formatMonthYear = (date: Date) => {
    return date.toLocaleDateString("en-US", { month: "long", year: "numeric" })
  }

  return (
    <div className="space-y-6 p-6">
      {/* Updated Toast */}
      {showUpdatedToast && (
        <div className="fixed top-4 right-4 z-50 bg-black text-white px-4 py-3 rounded-lg shadow-lg animate-in fade-in slide-in-from-top-2">
          Artist updated successfully.
        </div>
      )}

      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/dashboard/artists" className="hover:text-foreground">
          Artists
        </Link>
        <ChevronRight className="h-4 w-4" />
        <span className="text-foreground">Artist Profile</span>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="flex items-center justify-center w-16 h-16 rounded-full bg-muted text-2xl font-semibold">
            {displayName.charAt(0).toUpperCase()}
          </div>
          <div>
            <h1 className="text-2xl font-semibold">{displayName}</h1>
            {realName && <p className="text-muted-foreground">{realName}</p>}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" asChild>
            <Link href={`/dashboard/artists/${artist.id}/edit`}>
              <Edit className="mr-2 h-4 w-4" />
              Edit
            </Link>
          </Button>
          <Button variant="outline" disabled title="Coming soon">
            <MessageSquare className="mr-2 h-4 w-4" />
            Message
          </Button>
          <Button onClick={() => setIsBookingModalOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            New Booking
          </Button>
        </div>
      </div>

      {/* Two-column info cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Contact Information Card */}
        <Card>
          <CardContent className="p-6">
            <h3 className="text-lg font-semibold mb-4">Contact Information</h3>
            <div className="grid grid-cols-2 gap-y-4 gap-x-8">
              <div>
                <p className="text-sm text-muted-foreground">Contact name</p>
                <p className="font-medium">
                  {contactName || realName || displayName}
                </p>
              </div>
              <div />
              <div>
                <p className="text-sm text-muted-foreground">Email</p>
                {artist.email ? (
                  <a
                    href={`mailto:${artist.email}`}
                    className="font-medium hover:underline"
                  >
                    {artist.email}
                  </a>
                ) : (
                  <p className="text-muted-foreground italic">Not provided</p>
                )}
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Phone number</p>
                {artist.phone ? (
                  <a
                    href={`tel:${artist.phone}`}
                    className="font-medium hover:underline"
                  >
                    {artist.phone}
                  </a>
                ) : (
                  <p className="text-muted-foreground italic">Not provided</p>
                )}
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Location</p>
                <p className="font-medium">
                  {artist.location || (
                    <span className="text-muted-foreground italic">
                      Not provided
                    </span>
                  )}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">
                  Social media & Website
                </p>
                {socialLinks.length > 0 ? (
                  <div className="flex items-center gap-2 mt-1">
                    {socialLinks.map((link, idx) => (
                      <a
                        key={idx}
                        href={ensureScheme(link.url)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center justify-center w-7 h-7 border rounded text-xs font-medium hover:bg-muted"
                        title={link.type}
                      >
                        {getSocialIcon(link.type)}
                      </a>
                    ))}
                  </div>
                ) : (
                  <p className="text-muted-foreground italic">None added</p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Pricing Card */}
        <Card className="bg-[#f9fafb]">
          <CardContent className="p-6">
            <h3 className="text-lg font-semibold mb-4">Pricing</h3>
            <div className="grid grid-cols-2 gap-y-4 gap-x-8">
              <div>
                <p className="text-sm text-muted-foreground">Base rate</p>
                {artist.fee !== null && artist.fee !== undefined ? (
                  <p className="font-medium text-lg">
                    {formatArtistBaseRate(artist.fee, artist.currency)}/event
                  </p>
                ) : (
                  <p className="text-muted-foreground italic">Not specified</p>
                )}
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Travel Fee</p>
                <p className="font-medium">
                  {artist.travel_fee || (
                    <span className="text-muted-foreground italic">
                      Not specified
                    </span>
                  )}
                </p>
              </div>
              {artist.pricing_notes && (
                <div className="col-span-2">
                  <p className="text-sm text-muted-foreground">
                    Additional info
                  </p>
                  <p className="text-sm mt-1">{artist.pricing_notes}</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs Section */}
      <Card>
        <CardContent className="p-6">
          <Tabs
            value={currentTab}
            onValueChange={handleTabChange}
            className="w-full"
          >
            <TabsList className="w-full justify-start border-b rounded-none h-auto p-0 bg-transparent">
              <TabsTrigger
                value="overview"
                className="rounded-none border-b-2 border-transparent data-[state=active]:border-foreground data-[state=active]:bg-transparent px-4 py-2"
              >
                Overview
              </TabsTrigger>
              <TabsTrigger
                value="calendar"
                className="rounded-none border-b-2 border-transparent data-[state=active]:border-foreground data-[state=active]:bg-transparent px-4 py-2"
              >
                Calendar
              </TabsTrigger>
              <TabsTrigger
                value="documents"
                className="rounded-none border-b-2 border-transparent data-[state=active]:border-foreground data-[state=active]:bg-transparent px-4 py-2"
              >
                Documents
              </TabsTrigger>
              <TabsTrigger
                value="special"
                className="rounded-none border-b-2 border-transparent data-[state=active]:border-foreground data-[state=active]:bg-transparent px-4 py-2"
              >
                Special requirements
              </TabsTrigger>
            </TabsList>

            {/* Overview Tab */}
            <TabsContent value="overview" className="mt-6 space-y-8">
              {/* About Section */}
              <section>
                <h3 className="text-xl font-semibold mb-3">
                  About {displayName}
                </h3>
                {artist.overview ? (
                  <div className="text-muted-foreground whitespace-pre-wrap leading-relaxed">
                    {artist.overview}
                  </div>
                ) : (
                  <p className="text-muted-foreground italic">
                    No bio provided yet.
                  </p>
                )}
              </section>

              {/* Genres Section */}
              <section>
                <h3 className="text-xl font-semibold mb-3">Genres</h3>
                {artist.genres && artist.genres.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {artist.genres.map((genre) => (
                      <Badge
                        key={genre}
                        variant="outline"
                        className="px-3 py-1 font-normal"
                      >
                        {genre}
                      </Badge>
                    ))}
                  </div>
                ) : (
                  <p className="text-muted-foreground italic">
                    No genres specified.
                  </p>
                )}
              </section>

              {/* Equipment Section */}
              <section>
                <h3 className="text-xl font-semibold mb-3">Equipment</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div>
                    <h4 className="font-medium mb-2">DJ Equipment</h4>
                    {djEquipmentList.length > 0 ? (
                      <ul className="space-y-1">
                        {djEquipmentList.map((item, idx) => (
                          <li key={idx} className="text-muted-foreground">
                            • {item}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-muted-foreground italic">
                        Not specified
                      </p>
                    )}
                  </div>
                  <div>
                    <h4 className="font-medium mb-2">Sound System</h4>
                    {soundSystemList.length > 0 ? (
                      <ul className="space-y-1">
                        {soundSystemList.map((item, idx) => (
                          <li key={idx} className="text-muted-foreground">
                            • {item}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-muted-foreground italic">
                        Not specified
                      </p>
                    )}
                  </div>
                </div>
              </section>

              {/* Latest Events Section */}
              <section>
                <h3 className="text-xl font-semibold mb-3">Latest events</h3>
                <p className="text-muted-foreground italic">No events yet.</p>
              </section>
            </TabsContent>

            {/* Calendar Tab */}
            <TabsContent value="calendar" className="mt-6">
              <div className="flex flex-col lg:flex-row gap-6">
                {/* Events List Section */}
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-xl font-semibold">
                      Active Bookings & Events
                    </h3>
                    <span className="text-sm text-muted-foreground">All upcoming</span>
                  </div>

                  {calendarError ? (
                    <div role="alert" className="text-center py-12 border rounded-lg text-destructive">
                      Unable to load this artist’s calendar. Please refresh to try again.
                    </div>
                  ) : hasCalendarItems ? (
                    /* Persisted bookings and events */
                    <div className="space-y-3">
                      {calendarEvents.map((event) => (
                        <div
                          key={event.id}
                          className="flex items-center justify-between p-4 border rounded-lg"
                        >
                          <div className="flex items-center gap-4">
                            <div className="flex flex-col items-center justify-center w-12 h-12 bg-muted rounded text-center">
                              <span className="text-xs font-medium uppercase text-muted-foreground">
                                {event.date.toLocaleDateString("en-US", {
                                  month: "short",
                                })}
                              </span>
                              <span className="text-lg font-semibold">
                                {event.date.getDate()}
                              </span>
                            </div>
                            <div>
                              <p className="font-medium">
                                {event.href ? <Link href={event.href} className="hover:underline">{event.title}</Link> : event.title}
                              </p>
                              <p className="text-sm text-muted-foreground">
                                {[event.location, event.time].filter(Boolean).join(" • ")}
                              </p>
                            </div>
                          </div>

                        </div>
                      ))}


                    </div>
                  ) : (
                    /* Empty State */
                    <div className="text-center py-12 border rounded-lg">
                      <p className="text-muted-foreground mb-4">
                        No upcoming bookings or events for this artist.
                      </p>
                      <Button onClick={() => setIsBookingModalOpen(true)}>
                        <Plus className="mr-2 h-4 w-4" />
                        Add on Calendar
                      </Button>
                    </div>
                  )}
                </div>

                {/* Calendar Widget */}
                <div className="lg:w-80">
                  <div className="border rounded-lg p-4">
                    <div className="flex items-center justify-between mb-4">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={handlePreviousMonth}
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </Button>
                      <span className="font-medium">
                        {formatMonthYear(calendarMonth)}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={handleNextMonth}
                      >
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </div>
                    <Calendar
                      mode="multiple"
                      today={today}
                      selected={calendarEvents.map((event) => event.date)}
                      month={calendarMonth}
                      onMonthChange={setCalendarMonth}
                      className="rounded-md"
                    />
                  </div>
                </div>
              </div>
            </TabsContent>

            {/* Documents Tab */}
            <TabsContent value="documents" className="mt-6">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-xl font-semibold">Documents</h3>
                <Button variant="outline" disabled title="Coming soon">
                  <Upload className="mr-2 h-4 w-4" />
                  Upload Document
                </Button>
              </div>

              {documents.length > 0 ? (
                <div className="space-y-3">
                  {documents.map((doc, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between p-4 border rounded-lg"
                    >
                      <div className="flex items-center gap-3">
                        <div className="flex items-center justify-center w-10 h-10 bg-muted rounded">
                          <FileText className="h-5 w-5 text-muted-foreground" />
                        </div>
                        <div>
                          <p className="font-medium">{doc.name}</p>
                          <p className="text-sm text-muted-foreground">
                            Document
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button variant="ghost" size="sm" asChild>
                          <a
                            href={doc.url}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            View
                          </a>
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-destructive"
                          disabled
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-12 border rounded-lg">
                  <FileText className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                  <p className="text-muted-foreground mb-4">
                    No documents uploaded yet.
                  </p>
                  <Button variant="outline" disabled title="Coming soon">
                    <Upload className="mr-2 h-4 w-4" />
                    Upload Document
                  </Button>
                </div>
              )}
            </TabsContent>

            {/* Special Requirements Tab */}
            <TabsContent value="special" className="mt-6 space-y-8">
              <section>
                <h3 className="text-xl font-semibold mb-3">Allergies</h3>
                {artist.allergies ? (
                  <p className="text-muted-foreground whitespace-pre-wrap">
                    {artist.allergies}
                  </p>
                ) : (
                  <p className="text-muted-foreground italic">
                    No allergies specified.
                  </p>
                )}
              </section>

              <section>
                <h3 className="text-xl font-semibold mb-3">
                  Special dietary requirements
                </h3>
                {artist.special_diet ? (
                  <p className="text-muted-foreground whitespace-pre-wrap">
                    {artist.special_diet}
                  </p>
                ) : (
                  <p className="text-muted-foreground italic">
                    No dietary requirements specified.
                  </p>
                )}
              </section>

              <section>
                <h3 className="text-xl font-semibold mb-3">
                  Other special needs
                </h3>
                {artist.special_needs ? (
                  <p className="text-muted-foreground whitespace-pre-wrap">
                    {artist.special_needs}
                  </p>
                ) : (
                  <p className="text-muted-foreground italic">
                    No other special needs specified.
                  </p>
                )}
              </section>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* New Booking Modal */}
      <NewBookingModal
        open={isBookingModalOpen}
        onOpenChange={setIsBookingModalOpen}
        preselectedArtist={artist}
      />

      {/* Footer */}
      <footer className="flex items-center justify-center gap-6 pt-8 text-sm text-muted-foreground border-t">
        <Link
          href="/terms"
          className="hover:text-foreground transition-colors"
        >
          Terms
        </Link>
        <Link
          href="/privacy"
          className="hover:text-foreground transition-colors"
        >
          Privacy
        </Link>
        <Link href="/help" className="hover:text-foreground transition-colors">
          Help
        </Link>
        <Link
          href="/contact"
          className="hover:text-foreground transition-colors"
        >
          Contact
        </Link>
        <span className="ml-auto text-xs">
          © 2025 Backbeat. All rights reserved.
        </span>
      </footer>
    </div>
  )
}
