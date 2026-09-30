export type ArtistDirectoryEntry = {
  id: string
  name: string | null
  surname: string | null
  stage_name: string | null
  genres: string[]
  location: string | null
  fee: number | null
  currency: string | null
}

export function artistDisplayName(artist: ArtistDirectoryEntry): string {
  return artist.stage_name?.trim() ? artist.stage_name : artist.name?.trim() ? artist.name : "Unknown"
}

export function artistRealName(artist: ArtistDirectoryEntry): string {
  return [artist.name, artist.surname].filter(Boolean).join(" ").trim()
}

const collator = new Intl.Collator("en", { sensitivity: "base" })
const exactCompare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0

export function filterArtistDirectory(artists: readonly ArtistDirectoryEntry[], query: string): ArtistDirectoryEntry[] {
  const term = query.trim().toLowerCase()
  return artists.filter((artist) => [artistDisplayName(artist), artistRealName(artist), ...artist.genres, artist.location]
    .some((value) => value?.toLowerCase().includes(term)))
    .sort((a, b) => collator.compare(artistDisplayName(a), artistDisplayName(b))
      || exactCompare(artistDisplayName(a), artistDisplayName(b)) || exactCompare(a.id, b.id))
}
