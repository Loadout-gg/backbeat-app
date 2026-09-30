"use client"

import Link from "next/link"
import { Plus, Download, Search, MoreVertical } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { useMemo, useRef, useState } from "react"
import { artistDisplayName, artistRealName, filterArtistDirectory, type ArtistDirectoryEntry } from "@/lib/artist-list"

const PAGE_SIZE = 20

// Operate: the existing shell frames one readable, bounded directory panel.
export default function ArtistsListClient({ artists }: { artists: ArtistDirectoryEntry[] }) {
  const [query, setQuery] = useState("")
  const searchRef = useRef<HTMLInputElement>(null)

  const [requestedPage, setPage] = useState(1)
  const filtered = useMemo(() => filterArtistDirectory(artists, query), [artists, query])
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const page = Math.min(requestedPage, pageCount)
  // Clamp before paint when refreshed data shrinks.
  if (requestedPage !== page) setPage(page)
  const artistsWithDetails = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((artist) => ({
    id: artist.id,
    stageName: artistDisplayName(artist),
    realName: artistRealName(artist),
    displayGenres: artist.genres.length > 0 ? artist.genres.join(" / ") : "-",
    displayLocation: artist.location || "-",
    events: "Unavailable",
    displayFee: artist.fee === null ? "Not provided" : artist.currency?.trim()
      ? `${artist.currency} ${artist.fee.toLocaleString("en")}`
      : `${artist.fee.toLocaleString("en")} (currency unavailable)`,
  }))

  return (
    <div className="mx-auto w-full max-w-[100rem] min-w-0 p-4 sm:p-6">
      <h1 className="sr-only">Artists</h1>
      <div className="min-w-0 space-y-4 rounded-xl bg-muted/50 p-3 sm:p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex min-w-0 flex-1 basis-80 flex-wrap items-center gap-2">
            <div className="relative min-w-0 flex-1 basis-60">
              <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                ref={searchRef}
                type="search"
                aria-label="Search artists"
                value={query}
                onChange={(event) => { setQuery(event.target.value); setPage(1) }}
                placeholder="Search by name, genre or location"
                className="bg-background pl-9"
              />
            </div>
            {query && <Button variant="ghost" size="sm" onClick={() => { setQuery(""); setPage(1); searchRef.current?.focus() }}>Clear search</Button>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" disabled title="CSV export is unavailable">
              <Download aria-hidden="true" className="mr-2 h-4 w-4" />
              Download CSV (unavailable)
            </Button>
            <Button size="sm" asChild>
              <Link href="/dashboard/artists/new">
                <Plus aria-hidden="true" className="mr-2 h-4 w-4" />
                Add artist
              </Link>
            </Button>
          </div>
        </div>

        <p className="text-sm text-muted-foreground">Artists · A–Z</p>

        {artists.length === 0 ? (
          <div className="rounded-xl bg-background px-4 py-12 text-center">
            <p className="text-muted-foreground mb-4">No artists yet. Add your first artist to get started.</p>
            <Button asChild>
              <Link href="/dashboard/artists/new">
                <Plus aria-hidden="true" className="mr-2 h-4 w-4" />
                Add artist
              </Link>
            </Button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-xl bg-background px-4 py-12 text-center text-sm">No artists match your search.</div>
        ) : (
          <div role="region" aria-label="Artists table" tabIndex={0} className="min-w-0 overflow-x-auto rounded-xl bg-background focus-visible:outline-2 focus-visible:outline-ring [&_[data-slot=table-container]]:overflow-visible">
            <Table className="min-w-[56rem] table-fixed [&_td]:whitespace-normal [&_td]:break-words [&_td]:py-3 [&_td]:leading-5">
              <colgroup>
                <col className="w-12" />
                <col className="w-[25%]" />
                <col className="w-[17%]" />
                <col className="w-[20%]" />
                <col className="w-28" />
                <col />
                <col className="w-20" />
              </colgroup>
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <TableHead><span className="sr-only">Initial</span></TableHead>
                  <TableHead aria-sort="ascending">Artist</TableHead>
                  <TableHead>Genres</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead className="text-center">Events</TableHead>
                  <TableHead className="text-center">Fee</TableHead>
                  <TableHead className="text-center">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {artistsWithDetails.map((artist) => (
                  <TableRow key={artist.id} className="hover:bg-muted/50">
                    <TableCell>
                      <span aria-hidden="true" className="flex items-center justify-center w-8 h-8 rounded-full bg-muted text-xs font-medium">
                        {artist.stageName.trim().charAt(0).toUpperCase()}
                      </span>
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
                          <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Actions for ${artist.stageName}`}>
                            <MoreVertical aria-hidden="true" className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem asChild>
                            <Link href={`/dashboard/artists/${artist.id}`}>View details</Link>
                          </DropdownMenuItem>
                          <DropdownMenuItem asChild><Link href={`/dashboard/artists/${artist.id}/edit`}>Edit</Link></DropdownMenuItem>
                          <DropdownMenuItem disabled>Delete (unavailable)</DropdownMenuItem>
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
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p role="status" className="text-sm text-muted-foreground tabular-nums">
              Showing {filtered.length ? (page - 1) * PAGE_SIZE + 1 : 0}-{Math.min(page * PAGE_SIZE, filtered.length)} of {filtered.length} artists
            </p>
            <nav aria-label="Artists pagination" className="flex flex-wrap items-center gap-2">
              {/* Keep the focused boundary control in the keyboard sequence. */}
              <Button variant="outline" size="sm" aria-disabled={page === 1} className="aria-disabled:opacity-50" onClick={() => { if (page > 1) setPage(page - 1) }}>Previous</Button>
              <span className="text-sm tabular-nums">Page {page} of {pageCount}</span>
              <Button variant="outline" size="sm" aria-disabled={page === pageCount} className="aria-disabled:opacity-50" onClick={() => { if (page < pageCount) setPage(page + 1) }}>Next</Button>
            </nav>
          </div>
        )}

      </div>
    </div>
  )
}
