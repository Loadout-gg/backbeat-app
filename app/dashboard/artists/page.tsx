import Link from "next/link"
import { Plus, Download, Search, MoreVertical } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { listArtists } from "@/lib/actions/artists"

export default async function ArtistsPage() {
  const artists = await listArtists()

  const artistsWithDetails = artists.map((artist, idx) => ({
    ...artist,
    stageName: artist.name,
    realName: "Nome Cognome",
    genres: idx % 3 === 0 ? "Hip Hop / Dance / Electro" : idx % 2 === 0 ? "Dance" : "Electro",
    location: "New York, NY (USA)",
    events: 12,
    fee: "$2-3k",
  }))

  return (
    <div className="space-y-6 p-6">
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
                <TableRow key={artist.id}>
                  <TableCell>
                    <div className="flex items-center justify-center w-8 h-8 rounded-full bg-muted text-xs font-medium">
                      X
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="font-medium">{artist.stageName}</span>
                      <span className="text-sm text-muted-foreground">{artist.realName}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{artist.genres}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{artist.location}</TableCell>
                  <TableCell className="text-center text-sm">{artist.events}</TableCell>
                  <TableCell className="text-center text-sm">{artist.fee}</TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem>View details</DropdownMenuItem>
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
          <p className="text-sm text-muted-foreground">Showing 1-20 of {artists.length} artists</p>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled>
              Previous
            </Button>
            <Button variant="outline" size="sm" className="bg-primary text-primary-foreground">
              1
            </Button>
            <Button variant="outline" size="sm">
              2
            </Button>
            <Button variant="outline" size="sm">
              3
            </Button>
            <Button variant="outline" size="sm">
              4
            </Button>
            <span className="px-2">...</span>
            <Button variant="outline" size="sm">
              10
            </Button>
            <Button variant="outline" size="sm">
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
