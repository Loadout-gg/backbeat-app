import { expect, it } from "vitest"
import { artistDisplayName, artistRealName, filterArtistDirectory, type ArtistDirectoryEntry } from "@/lib/artist-list"
const entry = (id: string, stage_name: string | null): ArtistDirectoryEntry => ({ id, stage_name, name: null, surname: null, genres: [], location: null, fee: null, currency: null })
it("preserves input order, fields and displayed spelling while deriving a new sorted array", () => {
  const rows = Object.freeze([Object.freeze(entry("z", "Zulu")), Object.freeze(entry("a", "  Aurora  "))])
  expect(filterArtistDirectory(rows, "").map((row) => row.id)).toEqual(["a", "z"])
  expect(rows.map((row) => row.id)).toEqual(["z", "a"])
  expect(artistDisplayName(rows[1])).toBe("  Aurora  ")
})
it("uses exact name then ID tie-breaks independent of source order", () => {
  const rows = [entry("b", "alpha"), entry("d", "Alpha"), entry("c", "Alpha"), entry("e", "Álpha")]
  expect(filterArtistDirectory(rows, "").map((row) => row.id)).toEqual(["c", "d", "b", "e"])
  expect(filterArtistDirectory([...rows].reverse(), "")).toEqual(filterArtistDirectory(rows, ""))
})
it("falls back from blank stage name to name and Unknown", () => {
  expect(artistDisplayName({ ...entry("a", " "), name: "Mila" })).toBe("Mila")
  expect(artistDisplayName(entry("a", null))).toBe("Unknown")
  expect(artistRealName({ ...entry("a", null), surname: "Gray" })).toBe("Gray")
})
it("treats regex punctuation literally and does not promise accent folding", () => {
  const rows = [entry("a", "[live]"), entry("b", "Café")]
  expect(filterArtistDirectory(rows, ".*")).toEqual([])
  expect(filterArtistDirectory(rows, "[live]")).toEqual([rows[0]])
  expect(filterArtistDirectory(rows, "cafe")).toEqual([])
})
