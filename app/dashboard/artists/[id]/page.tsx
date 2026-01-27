import { notFound } from "next/navigation"
import Link from "next/link"
import { ArrowLeft, Mail, Phone, MapPin, Globe, Instagram, Music, Edit } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { getArtist } from "@/lib/actions/artists"

interface ArtistDetailPageProps {
  params: Promise<{ id: string }>
}

export default async function ArtistDetailPage({ params }: ArtistDetailPageProps) {
  const { id } = await params
  const artist = await getArtist(id)

  if (!artist) {
    notFound()
  }

  const displayName = artist.stage_name || artist.name || "Unknown Artist"
  const realName = artist.surname 
    ? `${artist.name || ""} ${artist.surname}`.trim() 
    : artist.name !== artist.stage_name ? artist.name : null

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/dashboard/artists">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div className="flex items-center gap-4">
            <div className="flex items-center justify-center w-16 h-16 rounded-full bg-muted text-2xl font-semibold">
              {displayName.charAt(0).toUpperCase()}
            </div>
            <div>
              <h1 className="text-2xl font-semibold">{displayName}</h1>
              {realName && (
                <p className="text-muted-foreground">{realName}</p>
              )}
            </div>
          </div>
        </div>
        <Button variant="outline" asChild>
          <Link href={`/dashboard/artists/${id}/edit`}>
            <Edit className="mr-2 h-4 w-4" />
            Edit Artist
          </Link>
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Overview */}
          <Card>
            <CardHeader>
              <CardTitle>Overview</CardTitle>
            </CardHeader>
            <CardContent>
              {artist.overview ? (
                <p className="text-muted-foreground whitespace-pre-wrap">{artist.overview}</p>
              ) : (
                <p className="text-muted-foreground italic">No overview provided</p>
              )}
            </CardContent>
          </Card>

          {/* Music Genres */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Music className="h-5 w-5" />
                Music Genres
              </CardTitle>
            </CardHeader>
            <CardContent>
              {artist.genres && artist.genres.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {artist.genres.map((genre) => (
                    <Badge key={genre} variant="secondary">
                      {genre}
                    </Badge>
                  ))}
                </div>
              ) : (
                <p className="text-muted-foreground italic">No genres specified</p>
              )}
            </CardContent>
          </Card>

          {/* Equipment */}
          <Card>
            <CardHeader>
              <CardTitle>Equipment</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <h4 className="font-medium mb-1">DJ Equipment</h4>
                {artist.dj_equipment ? (
                  <p className="text-muted-foreground whitespace-pre-wrap">{artist.dj_equipment}</p>
                ) : (
                  <p className="text-muted-foreground italic">Not specified</p>
                )}
              </div>
              <Separator />
              <div>
                <h4 className="font-medium mb-1">Sound System Requirements</h4>
                {artist.sound_system ? (
                  <p className="text-muted-foreground whitespace-pre-wrap">{artist.sound_system}</p>
                ) : (
                  <p className="text-muted-foreground italic">Not specified</p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Special Requirements */}
          <Card>
            <CardHeader>
              <CardTitle>Special Requirements</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <h4 className="font-medium mb-1">Allergies</h4>
                {artist.allergies ? (
                  <p className="text-muted-foreground">{artist.allergies}</p>
                ) : (
                  <p className="text-muted-foreground italic">None specified</p>
                )}
              </div>
              <Separator />
              <div>
                <h4 className="font-medium mb-1">Special Diet</h4>
                {artist.special_diet ? (
                  <p className="text-muted-foreground">{artist.special_diet}</p>
                ) : (
                  <p className="text-muted-foreground italic">None specified</p>
                )}
              </div>
              <Separator />
              <div>
                <h4 className="font-medium mb-1">Special Needs & Accessibility</h4>
                {artist.special_needs ? (
                  <p className="text-muted-foreground">{artist.special_needs}</p>
                ) : (
                  <p className="text-muted-foreground italic">None specified</p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Notes */}
          {artist.notes && (
            <Card>
              <CardHeader>
                <CardTitle>Notes</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground whitespace-pre-wrap">{artist.notes}</p>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Contact Info */}
          <Card>
            <CardHeader>
              <CardTitle>Contact Info</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {artist.location && (
                <div className="flex items-center gap-3">
                  <MapPin className="h-4 w-4 text-muted-foreground" />
                  <span>{artist.location}</span>
                </div>
              )}
              {artist.email && (
                <div className="flex items-center gap-3">
                  <Mail className="h-4 w-4 text-muted-foreground" />
                  <a href={`mailto:${artist.email}`} className="hover:underline">
                    {artist.email}
                  </a>
                </div>
              )}
              {artist.phone && (
                <div className="flex items-center gap-3">
                  <Phone className="h-4 w-4 text-muted-foreground" />
                  <a href={`tel:${artist.phone}`} className="hover:underline">
                    {artist.phone}
                  </a>
                </div>
              )}
              {!artist.location && !artist.email && !artist.phone && (
                <p className="text-muted-foreground italic">No contact info provided</p>
              )}
            </CardContent>
          </Card>

          {/* Pricing */}
          <Card>
            <CardHeader>
              <CardTitle>Pricing</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <h4 className="text-sm text-muted-foreground">Base Rate</h4>
                {artist.fee ? (
                  <p className="text-lg font-semibold">
                    {artist.currency || "$"}{artist.fee.toLocaleString()}
                  </p>
                ) : (
                  <p className="text-muted-foreground italic">Not specified</p>
                )}
              </div>
              {artist.travel_fee && (
                <div>
                  <h4 className="text-sm text-muted-foreground">Travel Fee</h4>
                  <p>{artist.travel_fee}</p>
                </div>
              )}
              {artist.pricing_notes && (
                <div>
                  <h4 className="text-sm text-muted-foreground">Notes</h4>
                  <p className="text-sm">{artist.pricing_notes}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Social Links */}
          <Card>
            <CardHeader>
              <CardTitle>Social Media & Website</CardTitle>
            </CardHeader>
            <CardContent>
              {artist.social_links && artist.social_links.length > 0 ? (
                <div className="space-y-2">
                  {artist.social_links.map((link, index) => (
                    <a
                      key={index}
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 text-sm hover:underline"
                    >
                      {link.type.toLowerCase().includes("instagram") ? (
                        <Instagram className="h-4 w-4" />
                      ) : (
                        <Globe className="h-4 w-4" />
                      )}
                      {link.type}
                    </a>
                  ))}
                </div>
              ) : (
                <p className="text-muted-foreground italic">No social links added</p>
              )}
            </CardContent>
          </Card>

          {/* Documents */}
          <Card>
            <CardHeader>
              <CardTitle>Documents</CardTitle>
            </CardHeader>
            <CardContent>
              {artist.documents && artist.documents.length > 0 ? (
                <div className="space-y-2">
                  {artist.documents.map((doc, index) => (
                    <a
                      key={index}
                      href={doc.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block text-sm hover:underline"
                    >
                      {doc.name}
                    </a>
                  ))}
                </div>
              ) : (
                <p className="text-muted-foreground italic">No documents uploaded</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
