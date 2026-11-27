import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { tableReads, tableReadsFromSource, type TableRead } from "./select-projection-scanner"

// Static guard (F19): no bookings read under lib/, app/ or components/ may select every
// column (`*` or a bare select()), and no list read may name notes, contact, fee or
// driver columns. Rows of list reads reach dashboard, artist profile and list clients
// (Alberto to Simone, 2026-11-23: "limit dashboard and profile data to the necessary
// fields"). The only wide read is the single-booking detail read below.
const WIDE_READ_ALLOWLIST = [{ file: join("lib", "actions", "bookings.ts"), fn: "getBooking" }]
const PRIVATE_COLUMN = /\bnotes\b|contact_|fee|driver_|workspace_id|expected_audience|event_type/

// Server-only source read (#35): conversion copies the fee into the new event inside the
// action and returns only { success, eventId | error }. Pinned to its exact columns, so any
// added column, a second read or a move to another function fails this guard.
const SERVER_ONLY_SOURCE_READS = [{
  file: join("lib", "actions", "booking-events.ts"),
  fn: "createEventFromBooking",
  columns: "id,status,date,start_time,venue_name,artist_id,promoter_id,fee_amount_minor,fee_currency,artist:artists(stage_name,name)",
}]

const isAllowlisted = ({ file, fn }: TableRead) =>
  WIDE_READ_ALLOWLIST.some(entry => entry.file === file && entry.fn === fn)
const isPinnedServerRead = ({ file, fn, columns }: TableRead) =>
  SERVER_ONLY_SOURCE_READS.some(entry => entry.file === file && entry.fn === fn && entry.columns === columns)

function projectionViolations(reads: TableRead[]): string[] {
  return reads.filter(read => !isAllowlisted(read) && !isPinnedServerRead(read)).flatMap(({ file, fn, columns }) => {
    const where = `${file}${fn ? ` ${fn}()` : ""}`
    if (columns === "") return [`${where}: bare select() reads every bookings column`]
    if (columns.includes("*")) return [`${where}: select("${columns}") reads every bookings column`]
    if (PRIVATE_COLUMN.test(columns)) return [`${where}: select("${columns}") reads a private column`]
    return []
  })
}

describe("bookings read projection", () => {
  const reads = tableReads("bookings")

  it("finds the bookings reads it guards", () => {
    const fns = reads.filter(read => read.file === join("lib", "actions", "bookings.ts")).map(read => read.fn)
    expect(fns).toEqual(expect.arrayContaining(["getBookings", "createBooking", "getBooking", "updateBookingStatus"]))
  })

  it("allows exactly one wide read: the single-booking detail read", () => {
    expect(reads.filter(isAllowlisted)).toHaveLength(1)
  })

  it("pins the one server-only source read to its exact columns", () => {
    expect(reads.filter(isPinnedServerRead)).toHaveLength(SERVER_ONLY_SOURCE_READS.length)
    expect(reads.filter(read => read.fn === "createEventFromBooking")).toHaveLength(1)
  })

  it("never selects every column or a private column in any other bookings read", () => {
    expect(projectionViolations(reads)).toEqual([])
  })

  it("keeps each list projection to the fields its caller renders", () => {
    const list = reads.filter(read => read.fn === "getBookings").map(read => read.columns)
    expect(list).toEqual([
      "id,artist_id,date,start_time,duration_minutes,status",
      "id,artist_id,date,start_time,duration_minutes,status,venue_name,venue_address,artist:artists(stage_name,name)",
      "id,artist_id,date,start_time,duration_minutes,status,hold_expires_on,created_at,venue_name,venue_address,artist:artists(stage_name,name)",
    ])
    expect(reads.find(read => read.fn === "createBooking")?.columns).toBe("id,artist_id,date")
  })

  it.each([
    [`function getBookings() { q.from("bookings").select("*") }`, "every bookings column"],
    [`function getBookings() { q.from("bookings").select(\`*, artist:artists(id)\`) }`, "every bookings column"],
    [`function getBookings() { q.from("bookings").select() }`, "bare select()"],
    [`function list() { q.from('bookings').select("id,notes") }`, "private column"],
    [`function list() { q.from("bookings").select("id,contact_email_main") }`, "private column"],
    [`function list() { q.from("bookings").select("id,artist:artists(name,fee)") }`, "private column"],
    [`const COLS = "id,fee_amount_minor"\nfunction list() { q.from("bookings").select(COLS, { count: "exact" }) }`, "private column"],
    [`const C = {\n  a: "id",\n  b: "*",\n} as const;\nfunction list() { q.from("bookings").select(C[k]) }`, "every bookings column"],
    [`function list() { q.from("artists").select("id, bookings(*)") }`, "every bookings column"],
    [`function getBooking() { q.from("bookings").select("*") }`, "every bookings column"],
  ])("rejects %s", (snippet, reason) => {
    // In a scratch file the allowlisted path never matches, so getBooking is not exempt.
    expect(projectionViolations(tableReadsFromSource("bookings", snippet)).join("\n")).toContain(reason)
  })
})
