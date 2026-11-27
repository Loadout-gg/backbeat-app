import { parseDocuments, parseSocialLinks } from "@/lib/artist-validation"

/** Fixed failure copy for the export; provider messages are never shown. */
export const ARTIST_EXPORT_ERROR = "Unable to export artists. Please try again."

/** Stored artist profile columns read for the export; `workspace_id` is ownership, not profile data. */
export const ARTIST_EXPORT_SELECT =
  "id,name,surname,stage_name,email,phone,notes,location,genres,fee,currency,travel_fee,pricing_notes,overview,dj_equipment,sound_system,allergies,special_diet,special_needs,social_links,documents,profile_image_url,created_at,updated_at"

export type ArtistExportRow = {
  id: string
  name: string | null
  surname: string | null
  stage_name: string | null
  email: string | null
  phone: string | null
  notes: string | null
  location: string | null
  genres: string[] | null
  fee: number | string | null
  currency: string | null
  travel_fee: string | null
  pricing_notes: string | null
  overview: string | null
  dj_equipment: string | null
  sound_system: string | null
  allergies: string | null
  special_diet: string | null
  special_needs: string | null
  social_links: unknown
  documents: unknown
  profile_image_url: string | null
  created_at: string | null
  updated_at: string | null
}

const TEXT_FIELDS = [
  "name", "surname", "stage_name", "email", "phone", "notes", "location", "currency", "travel_fee",
  "pricing_notes", "overview", "dj_equipment", "sound_system", "allergies", "special_diet",
  "special_needs", "profile_image_url", "created_at", "updated_at",
] as const

const text = (value: string | null | undefined) => value ?? ""

/** Explicit, ordered column list. Header names are a stable contract: append, never rename or reorder. */
export const ARTIST_CSV_COLUMNS: readonly { header: string; value: (row: ArtistExportRow) => string }[] = [
  { header: "Artist ID", value: (row) => row.id },
  { header: "Stage name", value: (row) => text(row.stage_name) },
  { header: "Name", value: (row) => text(row.name) },
  { header: "Surname", value: (row) => text(row.surname) },
  { header: "Email", value: (row) => text(row.email) },
  { header: "Phone", value: (row) => text(row.phone) },
  { header: "Location", value: (row) => text(row.location) },
  { header: "Genres", value: (row) => (row.genres ?? []).join("; ") },
  { header: "Fee", value: (row) => row.fee == null ? "" : String(row.fee) },
  { header: "Currency", value: (row) => text(row.currency) },
  { header: "Travel fee", value: (row) => text(row.travel_fee) },
  { header: "Pricing notes", value: (row) => text(row.pricing_notes) },
  { header: "Overview", value: (row) => text(row.overview) },
  { header: "DJ equipment", value: (row) => text(row.dj_equipment) },
  { header: "Sound system", value: (row) => text(row.sound_system) },
  { header: "Allergies", value: (row) => text(row.allergies) },
  { header: "Special diet", value: (row) => text(row.special_diet) },
  { header: "Special needs", value: (row) => text(row.special_needs) },
  { header: "Notes", value: (row) => text(row.notes) },
  { header: "Social links", value: (row) => parseSocialLinks(row.social_links).map((link) => `${link.type}: ${link.url}`).join("\n") },
  { header: "Documents", value: (row) => parseDocuments(row.documents).map((doc) => doc.url ? `${doc.name}: ${doc.url}` : doc.name).join("\n") },
  { header: "Profile image URL", value: (row) => text(row.profile_image_url) },
  { header: "Created at", value: (row) => text(row.created_at) },
  { header: "Updated at", value: (row) => text(row.updated_at) },
]

/** Reject rows whose stored types differ from the schema instead of exporting coerced values. */
export function isArtistExportRow(row: unknown): row is ArtistExportRow {
  if (!row || typeof row !== "object") return false
  const record = row as Record<string, unknown>
  if (typeof record.id !== "string" || !record.id.trim()) return false
  if (TEXT_FIELDS.some((field) => record[field] != null && typeof record[field] !== "string")) return false
  if (record.genres != null && (!Array.isArray(record.genres) || record.genres.some((genre) => typeof genre !== "string"))) return false
  if (record.fee != null && !(typeof record.fee === "number" && Number.isFinite(record.fee))
    && !(typeof record.fee === "string" && /^-?\d+(\.\d+)?$/.test(record.fee))) return false
  return true
}

const FORMULA_START = /^[=+\-@\t\r]/

/** Spreadsheet formula-injection guard: a leading apostrophe makes the cell literal text. */
export function guardCsvCell(value: string): string {
  return FORMULA_START.test(value) ? `'${value}` : value
}

/** RFC 4180 field: quoted when it holds a quote, comma, CR or LF; quotes are doubled. */
export function quoteCsvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

const BOM = "﻿"
const collator = new Intl.Collator("en", { sensitivity: "base" })
const exactCompare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0
const sortName = (row: ArtistExportRow) => row.stage_name?.trim() ? row.stage_name : row.name?.trim() ? row.name : ""

/** UTF-8 CSV with BOM, CRLF records, header row first, rows in directory (A–Z) order. */
export function buildArtistsCsv(rows: readonly ArtistExportRow[]): string {
  const sorted = [...rows].sort((a, b) => collator.compare(sortName(a), sortName(b))
    || exactCompare(sortName(a), sortName(b)) || exactCompare(a.id, b.id))
  const lines = [
    ARTIST_CSV_COLUMNS.map((column) => quoteCsvField(column.header)),
    ...sorted.map((row) => ARTIST_CSV_COLUMNS.map((column) => quoteCsvField(guardCsvCell(column.value(row))))),
  ]
  return BOM + lines.map((cells) => cells.join(",")).join("\r\n") + "\r\n"
}

export function artistsCsvFileName(calendarDay: string): string {
  return `artists-${calendarDay}.csv`
}
