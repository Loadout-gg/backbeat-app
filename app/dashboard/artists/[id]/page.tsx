"use client"

import { useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import Link from "next/link"
import { ChevronRight, Edit, MessageSquare, Plus, Mail, Phone, MapPin, Globe, FileText } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { getArtist, type Artist, type SocialLink } from "@/lib/actions/artists"
import { notFound } from "next/navigation"

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
  return "W"
}

// Parse social links safely
function parseSocialLinks(socialLinks: unknown): SocialLink[] {
  if (!socialLinks) return []
  
  // If it's already an array, return it
  if (Array.isArray(socialLinks)) {
    return socialLinks.filter(
      (link): link is SocialLink =>
        typeof link === "object" && link !== null && "type" in link && "url" in link
    )
  }
  
  // If it's a string, try to parse as JSON
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

interface ArtistProfileClientProps {
  artist: Artist
}

function ArtistProfileClient({ artist }: ArtistProfileClientProps) {
  const searchParams = useSearchParams()
  const [showUpdatedToast, setShowUpdatedToast] = useState(false)

  useEffect(() => {
    if (searchParams.get("updated") === "1") {
      setShowUpdatedToast(true)
      const timer = setTimeout(() => setShowUpdatedToast(false), 3000)
      // Clear URL param
      window.history.replaceState({}, "", `/dashboard/artists/${artist.id}`)
      return () => clearTimeout(timer)
    }
  }, [searchParams, artist.id])

  const displayName = artist.stage_name || artist.name || "Unknown Artist"
  const realName = artist.surname
    ? `${artist.name || ""} ${artist.surname}`.trim()
    : artist.name !== artist.stage_name
      ? artist.name
      : null

  const socialLinks = parseSocialLinks(artist.social_links)
  const djEquipmentList = formatEquipmentList(artist.dj_equipment)
  const soundSystemList = formatEquipmentList(artist.sound_system)

  // Extract contact name from notes if available
  const contactName = artist.notes?.startsWith("Contact: ")
    ? artist.notes.replace("Contact: ", "").split("\n")[0]
    : null

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
          <Button variant="outline">
            <MessageSquare className="mr-2 h-4 w-4" />
            Message
          </Button>
          <Button>
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
                <p className="font-medium">{contactName || realName || displayName}</p>
              </div>
              <div />
              <div>
                <p className="text-sm text-muted-foreground">Email</p>
                {artist.email ? (
                  <a href={`mailto:${artist.email}`} className="font-medium hover:underline">
                    {artist.email}
                  </a>
                ) : (
                  <p className="text-muted-foreground italic">Not provided</p>
                )}
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Phone number</p>
                {artist.phone ? (
                  <a href={`tel:${artist.phone}`} className="font-medium hover:underline">
                    {artist.phone}
                  </a>
                ) : (
                  <p className="text-muted-foreground italic">Not provided</p>
                )}
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Location</p>
                <p className="font-medium">{artist.location || <span className="text-muted-foreground italic">Not provided</span>}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Social media & Website</p>
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
        <Card className="bg-gray-50">
          <CardContent className="p-6">
            <h3 className="text-lg font-semibold mb-4">Pricing</h3>
            <div className="grid grid-cols-2 gap-y-4 gap-x-8">
              <div>
                <p className="text-sm text-muted-foreground">Base rate</p>
                {artist.fee ? (
                  <p className="font-medium text-lg">
                    {artist.currency || "$"}
                    {artist.fee.toLocaleString()}/event
                  </p>
                ) : (
                  <p className="text-muted-foreground italic">Not specified</p>
                )}
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Travel Fee</p>
                <p className="font-medium">{artist.travel_fee || <span className="text-muted-foreground italic">Not specified</span>}</p>
              </div>
              {artist.pricing_notes && (
                <div className="col-span-2">
                  <p className="text-sm text-muted-foreground">Additional info</p>
                  <p className="text-sm mt-1">{artist.pricing_notes}</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs Section */}
      <Tabs defaultValue="overview" className="w-full">
        <TabsList className="w-full justify-start border-b rounded-none h-auto p-0 bg-transparent">
          <TabsTrigger
            value="overview"
            className="rounded-none border-b-2 border-transparent data-[state=active]:border-black data-[state=active]:bg-transparent px-4 py-2"
          >
            Overview
          </TabsTrigger>
          <TabsTrigger
            value="calendar"
            className="rounded-none border-b-2 border-transparent data-[state=active]:border-black data-[state=active]:bg-transparent px-4 py-2"
          >
            Calendar
          </TabsTrigger>
          <TabsTrigger
            value="documents"
            className="rounded-none border-b-2 border-transparent data-[state=active]:border-black data-[state=active]:bg-transparent px-4 py-2"
          >
            Documents
          </TabsTrigger>
          <TabsTrigger
            value="special"
            className="rounded-none border-b-2 border-transparent data-[state=active]:border-black data-[state=active]:bg-transparent px-4 py-2"
          >
            Special requirements
          </TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="mt-6 space-y-8">
          {/* About Section */}
          <section>
            <h3 className="text-xl font-semibold mb-3">About {displayName}</h3>
            {artist.overview ? (
              <div className="text-muted-foreground whitespace-pre-wrap leading-relaxed">
                {artist.overview}
              </div>
            ) : (
              <p className="text-muted-foreground italic">No bio provided yet.</p>
            )}
          </section>

          {/* Genres Section */}
          <section>
            <h3 className="text-xl font-semibold mb-3">Genres</h3>
            {artist.genres && artist.genres.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {artist.genres.map((genre) => (
                  <Badge key={genre} variant="outline" className="px-3 py-1 font-normal">
                    {genre}
                  </Badge>
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground italic">No genres specified.</p>
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
                  <p className="text-muted-foreground italic">Not specified</p>
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
                  <p className="text-muted-foreground italic">Not specified</p>
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
          <div className="text-center py-12 text-muted-foreground">
            <p>Calendar view coming soon.</p>
          </div>
        </TabsContent>

        {/* Documents Tab */}
        <TabsContent value="documents" className="mt-6">
          {artist.documents && artist.documents.length > 0 ? (
            <div className="space-y-2">
              {artist.documents.map((doc, idx) => (
                <a
                  key={idx}
                  href={doc.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-3 p-3 border rounded-lg hover:bg-muted"
                >
                  <FileText className="h-5 w-5 text-muted-foreground" />
                  <span>{doc.name}</span>
                </a>
              ))}
            </div>
          ) : (
            <div className="text-center py-12 border-2 border-dashed rounded-lg">
              <FileText className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
              <p className="text-muted-foreground">No documents uploaded yet.</p>
            </div>
          )}
        </TabsContent>

        {/* Special Requirements Tab */}
        <TabsContent value="special" className="mt-6 space-y-6">
          <div>
            <h4 className="font-medium mb-2">Allergies</h4>
            <p className="text-muted-foreground">
              {artist.allergies || <span className="italic">None specified</span>}
            </p>
          </div>
          <div>
            <h4 className="font-medium mb-2">Special Diet</h4>
            <p className="text-muted-foreground">
              {artist.special_diet || <span className="italic">None specified</span>}
            </p>
          </div>
          <div>
            <h4 className="font-medium mb-2">Special Needs & Accessibility</h4>
            <p className="text-muted-foreground">
              {artist.special_needs || <span className="italic">None specified</span>}
            </p>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}

// Server component wrapper to fetch data
interface ArtistDetailPageProps {
  params: Promise<{ id: string }>
}

export default async function ArtistDetailPage({ params }: ArtistDetailPageProps) {
  const { id } = await params
  const artist = await getArtist(id)

  if (!artist) {
    notFound()
  }

  return <ArtistProfileClient artist={artist} />
}
