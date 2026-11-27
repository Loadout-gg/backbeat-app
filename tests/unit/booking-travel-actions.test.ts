import { beforeEach, expect, it, vi } from "vitest"
const { db, query, workspace, scans } = vi.hoisted(() => {
  const query: Record<string, ReturnType<typeof vi.fn>> = {}
  for (const method of ["insert", "update", "delete", "select", "eq", "in", "order", "range", "limit", "maybeSingle"]) query[method] = vi.fn()
  return {
    query, workspace: vi.fn(async () => "selected-workspace"),
    db: { from: vi.fn(), rpc: vi.fn(), auth: { getUser: vi.fn() } },
    scans: { enabled: vi.fn(() => false), reserve: vi.fn(), finalize: vi.fn() },
  }
})
vi.mock("@/lib/supabase/privileged", () => ({ travelDocumentScansEnabled: scans.enabled }))
vi.mock("@/lib/travel-documents/scan-service", () => ({
  SCAN_FAILURE_COPY: { disabled: "Scan storage is not enabled yet.", invalid_file: "The file was not accepted." },
  reserveScanUpload: scans.reserve, finalizeScanUpload: scans.finalize,
}))
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => db) }))
vi.mock("@/lib/actions/workspace", () => ({ getCurrentWorkspaceId: workspace }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
import {
  createBookingStay, createTravelLeg, deleteBookingStay, deleteTravelLeg, getBookingTravel,
  updateBookingStay, updateBookingTransportToCity, updateTravelLeg,
} from "@/lib/actions/booking-travel"
import {
  createArtistTravelDocument, deleteArtistTravelDocument, endArtistRelationship, finalizeTravelDocumentScan,
  getArtistTravelProfile, reserveTravelDocumentScan, restoreArtistTravelDocument, resumeArtistRelationship,
  updateArtistDateOfBirth, updateArtistTravelDocument,
} from "@/lib/actions/artist-travel-documents"
import { revalidatePath } from "next/cache"

const booking = "11111111-1111-4111-8111-111111111111"
const row = "22222222-2222-4222-8222-222222222222"
const artist = "33333333-3333-4333-8333-333333333333"
const SECRET = "YA0000001-SECRET"
const legInput = { direction: "inbound" as const, driver_phone: "+39 555 0100" }
const stayInput = { name: "Hotel Moon" }
const docInput = { doc_type: "passport" as const, number: SECRET }

beforeEach(() => {
  db.auth.getUser.mockResolvedValue({ data: { user: { id: "user-a" } } })
  db.from.mockReturnValue(query)
  for (const method of Object.values(query)) method.mockReturnValue(query)
  query.maybeSingle.mockResolvedValue({ data: { id: row }, error: null })
  query.range.mockResolvedValue({ data: [], count: 0, error: null })
  query.limit.mockResolvedValue({ data: [], error: null })
  db.rpc.mockReset()
  scans.enabled.mockReturnValue(false)
})

const writes = [
  ["create leg", () => createTravelLeg(booking, legInput), "booking_travel_legs"],
  ["update leg", () => updateTravelLeg(booking, row, legInput), "booking_travel_legs"],
  ["delete leg", () => deleteTravelLeg(booking, row), "booking_travel_legs"],
  ["create stay", () => createBookingStay(booking, stayInput), "booking_stays"],
  ["update stay", () => updateBookingStay(booking, row, stayInput), "booking_stays"],
  ["delete stay", () => deleteBookingStay(booking, row), "booking_stays"],
  ["create document", () => createArtistTravelDocument(artist, docInput), "artist_travel_documents"],
  ["update document", () => updateArtistTravelDocument(artist, row, docInput), "artist_travel_documents"],
  ["date of birth", () => updateArtistDateOfBirth(artist, "1990-02-03"), "artists"],
  ["transport to the city", () => updateBookingTransportToCity(booking, "promoter"), "bookings"],
] as const

it.each(writes)("%s succeeds inside the authoritative workspace with a row witness", async (_label, action, table) => {
  expect(await action()).toEqual({ success: true })
  expect(db.from).toHaveBeenCalledWith(table)
  expect(workspace).toHaveBeenCalledOnce()
  expect(query.select).toHaveBeenCalledWith("id")
  const inserted = query.insert.mock.calls[0]?.[0]
  if (inserted) expect(inserted.workspace_id).toBe("selected-workspace")
  else expect(query.eq).toHaveBeenCalledWith("workspace_id", "selected-workspace")
  expect(revalidatePath).toHaveBeenCalled()
})

it.each(writes.filter(([label]) => !label.startsWith("create")))("%s reports not found on zero affected rows", async (_label, action) => {
  query.maybeSingle.mockResolvedValueOnce({ data: null, error: null })
  const result = await action()
  expect(result.success).toBe(false)
  expect((result as { error: string }).error).toMatch(/not found$/)
  expect(revalidatePath).not.toHaveBeenCalled()
})

it.each(writes)("%s returns fixed copy and logs only the error code", async (_label, action) => {
  const providerMessage = `new row violates check constraint, Failing row contains (${SECRET}, +39 555 0100)`
  query.maybeSingle.mockResolvedValueOnce({ data: null, error: { code: "XX000", message: providerMessage, details: providerMessage } })
  const log = vi.spyOn(console, "error").mockImplementation(() => {})
  try {
    const result = await action()
    expect(result.success).toBe(false)
    const error = (result as { error: string }).error
    expect(error).not.toContain(SECRET)
    expect(error).not.toContain("constraint")
    expect(JSON.stringify(log.mock.calls)).not.toContain(SECRET)
    expect(JSON.stringify(log.mock.calls)).not.toContain("555")
    expect(log.mock.calls[0][1]).toEqual({ code: "XX000" })
  } finally { log.mockRestore() }
})

it.each([
  ["23503", () => createTravelLeg(booking, legInput), "Booking not found"],
  ["23503", () => createArtistTravelDocument(artist, docInput), "Artist not found"],
  ["23514", () => updateBookingStay(booking, row, stayInput), "These details were not accepted. Check dates and lengths and try again."],
])("maps SQLSTATE %s to fixed copy", async (code, action, message) => {
  query.maybeSingle.mockResolvedValueOnce({ data: null, error: { code, message: "provider text" } })
  const log = vi.spyOn(console, "error").mockImplementation(() => {})
  try {
    expect(await action()).toEqual({ success: false, error: message })
  } finally { log.mockRestore() }
})

it.each([
  ["invalid leg", () => createTravelLeg(booking, { direction: "inbound", depart_date: "2030-05-02", arrive_date: "2030-05-01" })],
  ["bad booking id", () => createTravelLeg("not-a-uuid", legInput)],
  ["bad leg id", () => updateTravelLeg(booking, "x", legInput)],
  ["invalid stay", () => createBookingStay(booking, { name: "" })],
  ["invalid document", () => createArtistTravelDocument(artist, { doc_type: "passport", number: "" })],
  ["future birth date", () => updateArtistDateOfBirth(artist, "2999-01-01")],
  ["forged workspace key", () => createTravelLeg(booking, { ...legInput, workspace_id: "other" } as never)],
])("rejects %s before backend access", async (_label, action) => {
  const result = await action()
  expect(result.success).toBe(false)
  expect(db.from).not.toHaveBeenCalled()
  expect(db.auth.getUser).not.toHaveBeenCalled()
})

it("refuses writes without a session", async () => {
  db.auth.getUser.mockResolvedValue({ data: { user: null } })
  for (const [, action] of writes) expect(await action()).toEqual({ success: false, error: "Not authenticated" })
  expect(db.from).not.toHaveBeenCalled()
})

it("reads legs and stays with explicit projections, scoped to workspace and booking", async () => {
  query.range
    .mockResolvedValueOnce({ data: [{ id: "leg-1" }], count: 1, error: null })
    .mockResolvedValueOnce({ data: [{ id: "stay-1" }], count: 1, error: null })
  query.maybeSingle.mockResolvedValueOnce({ data: { id: booking, transport_to_city: "promoter" }, error: null })
  expect(await getBookingTravel(booking)).toEqual({ legs: [{ id: "leg-1" }], stays: [{ id: "stay-1" }], transportToCity: "promoter" })
  const selects = query.select.mock.calls.map(call => call[0])
  expect(selects).toEqual([
    "id,booking_id,direction,mode,carrier,reference,depart_place,depart_date,depart_time,depart_zone,arrive_place,arrive_date,arrive_time,arrive_zone,travellers,driver_name,driver_phone,notes",
    "id,booking_id,name,address,check_in_on,check_out_on,confirmation_ref,notes",
    "id,transport_to_city",
  ])
  expect(query.eq).toHaveBeenCalledWith("workspace_id", "selected-workspace")
  expect(query.eq).toHaveBeenCalledWith("booking_id", booking)
})

it("rejects a failed travel read with fixed copy instead of an empty list", async () => {
  query.range.mockResolvedValue({ data: null, count: null, error: { message: SECRET } })
  const log = vi.spyOn(console, "error").mockImplementation(() => {})
  try {
    await expect(getBookingTravel(booking)).rejects.toThrow("Unable to load travel and accommodation. Please try again.")
    expect(JSON.stringify(log.mock.calls)).not.toContain(SECRET)
  } finally { log.mockRestore() }
})

it("reads the artist travel profile with explicit projections: active cards, recovery view, scans without keys, audit", async () => {
  const file = "44444444-4444-4444-8444-444444444444"
  query.maybeSingle
    .mockResolvedValueOnce({ data: { id: artist, date_of_birth: "1990-02-03" }, error: null })
    .mockResolvedValueOnce({ data: { ended_at: null }, error: null })
  query.range
    .mockResolvedValueOnce({ data: [{ id: row, number: SECRET, current_file_id: file }], count: 1, error: null })
    .mockResolvedValueOnce({ data: [{ id: "old", doc_type: "passport", holder_name: "L", expires_on: "2020-01-01", archived_at: "2026-11-01T10:00:00+00:00", restore_until: "2999-11-01T10:00:00+00:00", archive_cause: "deleted", state: "archived", current_file_id: null },
      { id: "closed", doc_type: "id_card", holder_name: null, expires_on: null, archived_at: "2025-01-01T10:00:00+00:00", restore_until: "2026-01-01T10:00:00+00:00", archive_cause: "relationship_ended", state: "archived", current_file_id: file }], count: 2, error: null })
  query.limit
    .mockResolvedValueOnce({ data: [
      { id: "e1", action: "download_issued", detail: null, document_id: row, actor_id: "user-a", booking_id: booking, occurred_at: "2026-11-27T10:00:00+00:00" },
      { id: "e2", action: "archived", detail: "deleted", document_id: "old", actor_id: "user-b", booking_id: null, occurred_at: "2026-11-01T10:00:00+00:00" },
      { id: "e3", action: "document_purged", detail: null, document_id: "gone", actor_id: null, booking_id: null, occurred_at: "2026-10-01T10:00:00+00:00" }], error: null })
    .mockResolvedValueOnce({ data: [{ id: file, document_id: row, state: "ready", media_type: "application/pdf", byte_size: 2048 }], error: null })
  const profile = await getArtistTravelProfile(artist)
  expect(profile).toEqual({
    artistId: artist, dateOfBirth: "1990-02-03",
    documents: [{ id: row, number: SECRET, scan: { fileId: file, state: "ready", mediaType: "application/pdf", byteSize: 2048 } }],
    archived: [
      { id: "old", doc_type: "passport", holder_name: "L", expires_on: "2020-01-01", archived_at: "2026-11-01T10:00:00+00:00", restore_until: "2999-11-01T10:00:00+00:00", cause: "deleted", restorable: true, hasScan: false },
      { id: "closed", doc_type: "id_card", holder_name: null, expires_on: null, archived_at: "2025-01-01T10:00:00+00:00", restore_until: "2026-01-01T10:00:00+00:00", cause: "relationship_ended", restorable: false, hasScan: true },
    ],
    relationshipEndedAt: null,
    activity: [
      { id: "e1", action: "download_issued", detail: null, documentId: row, actor: "you", withBooking: true, occurredAt: "2026-11-27T10:00:00+00:00" },
      { id: "e2", action: "archived", detail: "deleted", documentId: "old", actor: "member", withBooking: false, occurredAt: "2026-11-01T10:00:00+00:00" },
      { id: "e3", action: "document_purged", detail: null, documentId: "gone", actor: "system", withBooking: false, occurredAt: "2026-10-01T10:00:00+00:00" },
    ],
    scansEnabled: false,
  })
  const selects = query.select.mock.calls.map(call => call[0])
  expect(selects).toEqual(expect.arrayContaining([
    "id,date_of_birth",
    "id,artist_id,doc_type,number,issuing_country,nationality,issued_on,expires_on,holder_name,current_file_id",
    "id,doc_type,holder_name,expires_on,archived_at,restore_until,archive_cause,state,current_file_id",
    "ended_at",
    "id,action,detail,document_id,actor_id,booking_id,occurred_at",
    "id,document_id,state,media_type,byte_size",
  ]))
  expect(selects).toHaveLength(6)
  // ACL-04 / BOOK-01: no Storage key, digest or user id of a colleague reaches a payload.
  for (const columns of selects) expect(columns).not.toMatch(/object_key|sha256|\*/)
  expect(JSON.stringify(profile)).not.toContain("user-b")
  expect(query.in).toHaveBeenCalledWith("state", ["active"])
  expect(query.in).toHaveBeenCalledWith("state", ["archived"])
  expect(query.eq).toHaveBeenCalledWith("workspace_id", "selected-workspace")
})

it("returns null for an artist outside the workspace and rejects a failed read", async () => {
  query.maybeSingle.mockResolvedValueOnce({ data: null, error: null })
  expect(await getArtistTravelProfile(artist)).toBeNull()
  query.maybeSingle.mockResolvedValueOnce({ data: null, error: { message: "down" } })
  const log = vi.spyOn(console, "error").mockImplementation(() => {})
  try {
    await expect(getArtistTravelProfile(artist)).rejects.toThrow("Unable to load travel documents. Please try again.")
  } finally { log.mockRestore() }
})

it("writes only date_of_birth and clears it with null or blank", async () => {
  await updateArtistDateOfBirth(artist, "")
  expect(query.update).toHaveBeenCalledWith({ date_of_birth: null })
})

// D1 / D5: "delete" is a recoverable archive through the member entry point; no table delete.
it("LIFE-01 delete archives through the member function with the selected workspace, never a table delete", async () => {
  db.rpc.mockResolvedValueOnce({ data: "archived", error: null })
  expect(await deleteArtistTravelDocument(artist, row)).toEqual({ success: true })
  expect(db.rpc).toHaveBeenCalledWith("backbeat_travel_document_archive", { p_workspace_id: "selected-workspace", p_document_id: row })
  expect(query.delete).not.toHaveBeenCalled()
  expect(db.from).not.toHaveBeenCalled()
  db.rpc.mockResolvedValueOnce({ data: "already_archived", error: null })
  expect(await deleteArtistTravelDocument(artist, row)).toEqual({ success: true })
})

it.each([
  ["archive: unknown or foreign card", () => deleteArtistTravelDocument(artist, row), "BB014", "Travel document not found"],
  ["restore: unknown or foreign card", () => restoreArtistTravelDocument(artist, row), "BB014", "Travel document not found"],
  ["LIFE-08 restore: window closed or purge claimed", () => restoreArtistTravelDocument(artist, row), "BB016", "This travel document can no longer be restored."],
  ["LIFE-05 restore: relationship ended", () => restoreArtistTravelDocument(artist, row), "BB019", "The relationship with this artist is ended. Resume it first."],
  ["relationship: unknown artist", () => endArtistRelationship(artist), "BB014", "Artist not found"],
  ["restore: other failure", () => restoreArtistTravelDocument(artist, row), "XX000", "Unable to restore the travel document. Please try again."],
])("%s -> fixed copy, only the code logged", async (_label, action, code, message) => {
  db.rpc.mockResolvedValueOnce({ data: null, error: { code, message: `provider text ${SECRET}` } })
  const log = vi.spyOn(console, "error").mockImplementation(() => {})
  try {
    expect(await action()).toEqual({ success: false, error: message })
    expect(JSON.stringify(log.mock.calls)).not.toContain(SECRET)
    expect(revalidatePath).not.toHaveBeenCalled()
  } finally { log.mockRestore() }
})

it("LIFE-05 / LIFE-07 restore and relationship end / resume call their member functions; nothing else is written", async () => {
  db.rpc.mockResolvedValue({ data: "restored", error: null })
  expect(await restoreArtistTravelDocument(artist, row)).toEqual({ success: true })
  expect(await endArtistRelationship(artist)).toEqual({ success: true })
  expect(await resumeArtistRelationship(artist)).toEqual({ success: true })
  expect(db.rpc.mock.calls).toEqual([
    ["backbeat_travel_document_restore", { p_workspace_id: "selected-workspace", p_document_id: row }],
    ["backbeat_travel_document_relationship_end", { p_workspace_id: "selected-workspace", p_artist_id: artist }],
    ["backbeat_travel_document_relationship_resume", { p_workspace_id: "selected-workspace", p_artist_id: artist }],
  ])
  expect(db.from).not.toHaveBeenCalled()
})

it("CORE-01 an edit only matches an active card; a new card while the relationship is ended gets fixed copy", async () => {
  await updateArtistTravelDocument(artist, row, docInput)
  expect(query.eq).toHaveBeenCalledWith("state", "active")
  query.maybeSingle.mockResolvedValueOnce({ data: null, error: { code: "BB019" } })
  const log = vi.spyOn(console, "error").mockImplementation(() => {})
  try {
    expect(await createArtistTravelDocument(artist, docInput)).toEqual({ success: false, error: "The relationship with this artist is ended. Resume it first." })
  } finally { log.mockRestore() }
})

it("DATA-01 nationality and issue date are written as their own fields; blank stays NULL", async () => {
  await createArtistTravelDocument(artist, { ...docInput, nationality: " Italian ", issued_on: "2024-02-29", issuing_country: "France" })
  expect(query.insert.mock.calls[0][0]).toMatchObject({ nationality: "Italian", issued_on: "2024-02-29", issuing_country: "France", expires_on: null, holder_name: null })
  await updateArtistTravelDocument(artist, row, { ...docInput, nationality: "", issued_on: "" })
  expect(query.update.mock.calls[0][0]).toMatchObject({ nationality: null, issued_on: null })
  expect(await createArtistTravelDocument(artist, { ...docInput, issued_on: "2023-02-29" })).toEqual({ success: false, error: "Enter a valid issue date" })
  expect(await createArtistTravelDocument(artist, { ...docInput, reason: "x" } as never)).toMatchObject({ success: false })
})

it("BOOK-02 transport to the city writes only its own column; unknown values never reach the backend", async () => {
  await updateBookingTransportToCity(booking, "")
  expect(query.update).toHaveBeenLastCalledWith({ transport_to_city: null })
  await updateBookingTransportToCity(booking, "not_needed")
  expect(query.update).toHaveBeenLastCalledWith({ transport_to_city: "not_needed" })
  db.from.mockClear()
  expect((await updateBookingTransportToCity(booking, "flight")).success).toBe(false)
  expect(db.from).not.toHaveBeenCalled()
})

it("FILE-01 scan actions validate ids, delegate to the trusted path and pass fixed copy through", async () => {
  expect(await reserveTravelDocumentScan(artist, "nope")).toEqual({ success: false, error: "Travel document not found" })
  expect(scans.reserve).not.toHaveBeenCalled()
  scans.reserve.mockResolvedValueOnce({ ok: false, failure: "disabled" })
  expect(await reserveTravelDocumentScan(artist, row)).toEqual({ success: false, error: "Scan storage is not enabled yet." })
  scans.reserve.mockResolvedValueOnce({ ok: true, fileId: "f", uploadUrl: "https://storage.example/upload?token=t" })
  expect(await reserveTravelDocumentScan(artist, row)).toEqual({ success: true, fileId: "f", uploadUrl: "https://storage.example/upload?token=t" })
  scans.finalize.mockResolvedValueOnce({ ok: false, failure: "invalid_file" })
  expect(await finalizeTravelDocumentScan(artist, row)).toEqual({ success: false, error: "The file was not accepted." })
  scans.finalize.mockResolvedValueOnce({ ok: true })
  expect(await finalizeTravelDocumentScan(artist, row)).toEqual({ success: true })
  expect(scans.finalize).toHaveBeenLastCalledWith(row)
})
