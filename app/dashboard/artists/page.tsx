import Link from "next/link"
import { Plus, Mail, Phone } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { listArtists } from "@/lib/actions/artists"

export default async function ArtistsPage() {
  const artists = await listArtists()

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Artists</h1>
          <p className="text-sm text-muted-foreground">Manage your artist roster</p>
        </div>
        <Button asChild>
          <Link href="/dashboard/artists/new">
            <Plus className="mr-2 h-4 w-4" />
            Add artist
          </Link>
        </Button>
      </div>

      {artists.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <p className="text-muted-foreground mb-4">No artists yet. Add your first artist to get started.</p>
            <Button asChild>
              <Link href="/dashboard/artists/new">
                <Plus className="mr-2 h-4 w-4" />
                Add artist
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {artists.map((artist) => (
            <Card key={artist.id}>
              <CardContent className="flex items-center justify-between p-4">
                <div>
                  <h3 className="font-medium">{artist.name}</h3>
                  <div className="flex items-center gap-4 mt-1 text-sm text-muted-foreground">
                    {artist.email && (
                      <span className="flex items-center gap-1">
                        <Mail className="h-3 w-3" />
                        {artist.email}
                      </span>
                    )}
                    {artist.phone && (
                      <span className="flex items-center gap-1">
                        <Phone className="h-3 w-3" />
                        {artist.phone}
                      </span>
                    )}
                  </div>
                  {artist.notes && <p className="text-sm text-muted-foreground mt-2 line-clamp-1">{artist.notes}</p>}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
