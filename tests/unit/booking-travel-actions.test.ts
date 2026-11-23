import { beforeEach, expect, it, vi } from "vitest"
const { db, query, workspace } = vi.hoisted(() => {
  const query: Record<string, ReturnType<typeof vi.fn>> = {}
  for (const method of ["insert", "update", "delete", "select", "eq", "order", "range", "maybeSingle"]) query[method] = vi.fn()
  return { query, workspace: vi.fn(async () => "selected-workspace"), db: { from: vi.fn(), auth: { getUser: vi.fn() } } }
})
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => db) }))
vi.mock("@/lib/actions/workspace", () => ({ getCurrentWorkspaceId: workspace }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
import {
  createBookingStay, createTravelLeg, deleteBookingStay, deleteTravelLeg, getBookingTravel,
  updateBookingStay, updateTravelLeg,
} from "@/lib/actions/booking-travel"
import {
  createArtistTravelDocument, deleteArtistTravelDocument, getArtistTravelProfile,
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
  ["delete document", () => deleteArtistTravelDocument(artist, row), "artist_travel_documents"],
  ["date of birth", () => updateArtistDateOfBirth(artist, "1990-02-03"), "artists"],
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
  expect(await getBookingTravel(booking)).toEqual({ legs: [{ id: "leg-1" }], stays: [{ id: "stay-1" }] })
  const selects = query.select.mock.calls.map(call => call[0])
  expect(selects).toEqual([
    "id,booking_id,direction,mode,carrier,reference,depart_place,depart_date,depart_time,depart_zone,arrive_place,arrive_date,arrive_time,arrive_zone,travellers,driver_name,driver_phone,notes",
    "id,booking_id,name,address,check_in_on,check_out_on,confirmation_ref,notes",
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

it("reads the artist travel profile with explicit projections only", async () => {
  query.maybeSingle.mockResolvedValueOnce({ data: { id: artist, date_of_birth: "1990-02-03" }, error: null })
  query.range.mockResolvedValueOnce({ data: [{ id: row, number: SECRET }], count: 1, error: null })
  expect(await getArtistTravelProfile(artist)).toEqual({ artistId: artist, dateOfBirth: "1990-02-03", documents: [{ id: row, number: SECRET }] })
  expect(query.select.mock.calls.map(call => call[0])).toEqual([
    "id,date_of_birth",
    "id,artist_id,doc_type,number,issuing_country,expires_on,holder_name",
  ])
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
