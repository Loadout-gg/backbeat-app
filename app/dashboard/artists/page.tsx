import Link from "next/link"
import { Plus, Download, Search, MoreVertical } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { listArtists } from "@/lib/actions/artists"

export default async function ArtistsPage() {
  const artists = await listArtists()

  const artistsWithDetails = artists.map((artist) => ({
    ...artist,
    stageName: artist.stage_name || artist.name,
    realName: artist.surname ? `${artist.name || ""} ${artist.surname}`.trim() : artist.name || "",
    displayGenres: artist.genres.length > 0 ? artist.genres.slice(0, 3).join(" / ") : "-",
    displayLocation: artist.location || "-",
    events: 0, // Will be calculated from events table in future
    displayFee:
      artist.fee && artist.currency
        ? `${artist.currency}${artist.fee.toLocaleString()}`
        : artist.fee
          ? `$${artist.fee.toLocaleString()}`
          : "-",
  }))

  return (
    <div className="space-y-6 p-6">
      <h1 className="sr-only">Artists</h1>
      <div className="flex items-center justify-between gap-4">
        <div className="flex-1 max-w-md relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search by name, genre or location" className="pl-9" />
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm">
            <Download className="mr-2 h-4 w-4" />
            Download CSV
          </Button>
          <Button size="sm" asChild>
            <Link href="/dashboard/artists/new">
              <Plus className="mr-2 h-4 w-4" />
              Add artist
            </Link>
          </Button>
        </div>
      </div>

      <div className="text-sm text-primary">
        Artists list:
        <br />
        <span className="font-medium">Ordine Alfabetico (A-Z)</span>
      </div>

      {artists.length === 0 ? (
        <div className="rounded-lg border bg-card p-12 text-center">
          <p className="text-muted-foreground mb-4">No artists yet. Add your first artist to get started.</p>
          <Button asChild>
            <Link href="/dashboard/artists/new">
              <Plus className="mr-2 h-4 w-4" />
              Add artist
            </Link>
          </Button>
        </div>
      ) : (
        <div className="rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[50px]"></TableHead>
                <TableHead>Artist</TableHead>
                <TableHead>Genres</TableHead>
                <TableHead>Location</TableHead>
                <TableHead className="text-center">Events</TableHead>
                <TableHead className="text-center">Fee</TableHead>
                <TableHead className="w-[50px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {artistsWithDetails.map((artist) => (
                <TableRow key={artist.id} className="cursor-pointer hover:bg-muted/50">
                  <TableCell>
                    <Link href={`/dashboard/artists/${artist.id}`} className="flex items-center justify-center w-8 h-8 rounded-full bg-muted text-xs font-medium">
                      {artist.stageName?.charAt(0).toUpperCase() || "A"}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Link href={`/dashboard/artists/${artist.id}`} className="flex flex-col">
                      <span className="font-medium hover:underline">{artist.stageName}</span>
                      {artist.realName && artist.realName !== artist.stageName && (
                        <span className="text-sm text-muted-foreground">{artist.realName}</span>
                      )}
                    </Link>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{artist.displayGenres}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{artist.displayLocation}</TableCell>
                  <TableCell className="text-center text-sm">{artist.events}</TableCell>
                  <TableCell className="text-center text-sm">{artist.displayFee}</TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem asChild>
                          <Link href={`/dashboard/artists/${artist.id}`}>View details</Link>
                        </DropdownMenuItem>
                        <DropdownMenuItem>Edit</DropdownMenuItem>
                        <DropdownMenuItem className="text-destructive">Delete</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {artists.length > 0 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Showing 1-{Math.min(20, artists.length)} of {artists.length} artists
          </p>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled>
              Previous
            </Button>
            <Button variant="outline" size="sm" className="bg-primary text-primary-foreground">
              1
            </Button>
            {artists.length > 20 && (
              <>
                <Button variant="outline" size="sm">
                  2
                </Button>
                <Button variant="outline" size="sm">
                  3
                </Button>
                <span className="px-2">...</span>
              </>
            )}
            <Button variant="outline" size="sm" disabled={artists.length <= 20}>
              Next
            </Button>
          </div>
        </div>
      )}

      <footer className="flex items-center justify-center gap-6 pt-8 text-sm text-muted-foreground border-t">
        <Link href="/terms" className="hover:text-foreground transition-colors">
          Terms
        </Link>
        <Link href="/privacy" className="hover:text-foreground transition-colors">
          Privacy
        </Link>
        <Link href="/help" className="hover:text-foreground transition-colors">
          Help
        </Link>
        <Link href="/contact" className="hover:text-foreground transition-colors">
          Contact
        </Link>
        <span className="ml-auto text-xs">© 2025 Backbeat. All rights reserved.</span>
      </footer>
    </div>
  )
}
