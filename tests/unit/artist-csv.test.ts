import { describe, expect, it } from "vitest"
import { ARTIST_CSV_COLUMNS, artistsCsvFileName, buildArtistsCsv, guardCsvCell, isArtistExportRow, quoteCsvField, type ArtistExportRow } from "@/lib/artist-csv"

const HEADERS = [
  "Artist ID", "Stage name", "Name", "Surname", "Email", "Phone", "Location", "Genres", "Fee", "Currency",
  "Travel fee", "Pricing notes", "Overview", "DJ equipment", "Sound system", "Allergies", "Special diet",
  "Special needs", "Notes", "Social links", "Documents", "Profile image URL", "Created at", "Updated at",
]
const row = (patch: Partial<ArtistExportRow> = {}): ArtistExportRow => ({
  id: "a1", name: "Mila", surname: "Rossi", stage_name: "Aurora", email: "mila@example.test", phone: "123",
  notes: null, location: "Milan", genres: ["House", "Techno"], fee: 1500, currency: "EUR", travel_fee: null,
  pricing_notes: null, overview: null, dj_equipment: null, sound_system: null, allergies: null, special_diet: null,
  special_needs: null, social_links: [], documents: [], profile_image_url: null,
  created_at: "2026-11-01T10:00:00+00:00", updated_at: "2026-11-02T10:00:00+00:00", ...patch,
})
const records = (csv: string) => csv.slice(1).split("\r\n")

describe("buildArtistsCsv", () => {
  it("starts with a UTF-8 BOM, uses CRLF records and ends with a newline", () => {
    const csv = buildArtistsCsv([row()])
    expect(csv.charCodeAt(0)).toBe(0xfeff)
    expect(csv.endsWith("\r\n")).toBe(true)
    expect(records(csv)).toHaveLength(3)
  })
  it("writes the explicit, stable column list in order", () => {
    expect(ARTIST_CSV_COLUMNS.map((column) => column.header)).toEqual(HEADERS)
    expect(records(buildArtistsCsv([]))[0]).toBe(HEADERS.join(","))
  })
  it("writes a header-only file for an empty workspace", () => {
    expect(buildArtistsCsv([])).toBe(`﻿${HEADERS.join(",")}\r\n`)
  })
  it("maps each stored field to its column", () => {
    const line = records(buildArtistsCsv([row({
      social_links: [{ type: "instagram", url: "https://i.test/a" }, { bogus: true }],
      documents: [{ name: "Rider", url: "https://d.test/r" }, { name: "Legacy" }],
    })]))[1]
    expect(line).toBe([
      "a1", "Aurora", "Mila", "Rossi", "mila@example.test", "123", "Milan", "House; Techno", "1500", "EUR",
      "", "", "", "", "", "", "", "", "", "instagram: https://i.test/a", "\"Rider: https://d.test/r\nLegacy\"", "",
      "2026-11-01T10:00:00+00:00", "2026-11-02T10:00:00+00:00",
    ].join(","))
  })
  it("keeps zero fees and leaves missing values empty", () => {
    const cells = records(buildArtistsCsv([row({ fee: 0, currency: null, genres: null })]))[1].split(",")
    expect(cells[HEADERS.indexOf("Fee")]).toBe("0")
    expect(cells[HEADERS.indexOf("Currency")]).toBe("")
    expect(cells[HEADERS.indexOf("Genres")]).toBe("")
  })
  it("quotes commas, quotes, CR and LF per RFC 4180", () => {
    const line = records(buildArtistsCsv([row({ notes: 'Says "hi", then\nleaves', location: "Rome, IT", overview: "a\rb" })]))[1]
    expect(line).toContain('"Rome, IT"')
    expect(line).toContain('"Says ""hi"", then\nleaves"')
    expect(line).toContain('"a\rb"')
  })
  it("orders rows by display name A–Z, then by ID", () => {
    const csv = buildArtistsCsv([row({ id: "3", stage_name: "zeta" }), row({ id: "2", stage_name: "Alpha" }), row({ id: "1", stage_name: "alpha" }), row({ id: "0", stage_name: null, name: "Beta" })])
    expect(records(csv).slice(1, 5).map((line) => line.split(",")[0])).toEqual(["2", "1", "0", "3"])
  })
  it("guards formula-like cells in data rows", () => {
    const line = records(buildArtistsCsv([row({ stage_name: "=HYPERLINK(\"x\")", name: "+1", surname: "-2", email: "@me", phone: "\t9", notes: "\rx" })]))[1]
    expect(line).toContain('"\'=HYPERLINK(""x"")"')
    expect(line).toContain(",'+1,'-2,'@me,'\t9,")
    expect(line).toContain('"\'\rx"')
  })
})

describe("cell helpers", () => {
  it.each(["=1", "+1", "-1", "@a", "\tx", "\rx"])("prefixes %j with an apostrophe", (value) => {
    expect(guardCsvCell(value)).toBe(`'${value}`)
  })
  it.each(["", "a=1", " =1", "'=1", "1-2"])("leaves %j unchanged", (value) => {
    expect(guardCsvCell(value)).toBe(value)
  })
  it("quotes only when required", () => {
    expect(quoteCsvField("plain")).toBe("plain")
    expect(quoteCsvField("")).toBe("")
    expect(quoteCsvField('a"b')).toBe('"a""b"')
  })
  it("names the file after the calendar day", () => {
    expect(artistsCsvFileName("2026-11-23")).toBe("artists-2026-11-23.csv")
  })
})

describe("isArtistExportRow", () => {
  it("accepts schema-shaped rows, including numeric-string fees", () => {
    expect(isArtistExportRow(row())).toBe(true)
    expect(isArtistExportRow(row({ fee: "1500.50" }))).toBe(true)
  })
  it.each([{ id: "" }, { id: 1 }, { name: 4 }, { genres: "House" }, { genres: [1] }, { fee: "abc" }, { fee: Infinity }, { created_at: 1 }])("rejects %j", (patch) => {
    expect(isArtistExportRow({ ...row(), ...patch })).toBe(false)
  })
})
