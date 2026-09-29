import { beforeEach, expect, it, vi } from "vitest"
const { db, query } = vi.hoisted(() => {
  const query: Record<string, ReturnType<typeof vi.fn>> = {}
  for (const method of ["insert", "update", "select", "eq", "single"]) query[method] = vi.fn()
  return { query, db: { from: vi.fn() } }
})
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => db) }))
vi.mock("@/lib/actions/workspace", () => ({ getCurrentWorkspaceId: vi.fn(async () => "workspace-a") }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
import { createArtist, updateArtist } from "@/lib/actions/artists"
beforeEach(() => {
  db.from.mockReturnValue(query)
  for (const method of Object.values(query)) method.mockReturnValue(query)
  query.single.mockResolvedValue({ data: { id: "artist-a" }, error: null })
})
it("persists the supplied real name separately from stage name", async () => {
  expect(await createArtist({ stage_name: "DJ Moon", name: "Luna" })).toEqual({ success: true, artistId: "artist-a" })
  expect(query.insert).toHaveBeenCalledWith(expect.objectContaining({ name: "Luna", stage_name: "DJ Moon" }))
})
it("does not overwrite real name when only stage name changes", async () => {
  await updateArtist("artist-a", { stage_name: "DJ Sun" })
  expect(query.update.mock.calls[0][0]).not.toHaveProperty("name")
  expect(query.eq).toHaveBeenCalledWith("workspace_id", "workspace-a")
})
it("clears an explicitly blank email to null (characterization)", async () => {
  expect(await updateArtist("artist-a", { email: "" })).toEqual({ success: true })
  expect(query.update).toHaveBeenCalledWith({ email: null })
})
it.each([{}, { email: undefined }])("leaves email unchanged when not supplied: %j (characterization)", async (input) => {
  expect(await updateArtist("artist-a", { stage_name: "DJ Sun", ...input })).toEqual({ success: true })
  expect(query.update).toHaveBeenCalledWith({ stage_name: "DJ Sun" })
  expect(query.update.mock.calls[0][0]).not.toHaveProperty("email")
})
it("updates a nonblank email (characterization)", async () => {
  expect(await updateArtist("artist-a", { email: "new@example.test" })).toEqual({ success: true })
  expect(query.update).toHaveBeenCalledWith({ email: "new@example.test" })
})
it.each([undefined, "", "   "])("falls back to stage name when real name is %s (characterization)", async (name) => {
  await createArtist({ stage_name: "DJ Moon", name })
  expect(query.insert).toHaveBeenCalledWith(expect.objectContaining({ name: "DJ Moon" }))
})

it.each([[0, 0], [null, null], [125, 125]] as const)("persists update fee %j without conflating zero and absent", async (value, expected) => {
  expect(await updateArtist("artist-a", { fee: value })).toEqual({ success: true })
  expect(query.update).toHaveBeenCalledWith({ fee: expected })
})

it.each([
  ["Private free note", "", "Private free note"],
  ["Private free note", "New contact", "Contact: New contact\nPrivate free note"],
  ["Contact: Old\nKeep this note\nAnd this", "", "Keep this note\nAnd this"],
  ["Contact: Old\nKeep this note", "New contact", "Contact: New contact\nKeep this note"],
  ["Contact: Old", "", null],
])("preserves unrelated notes when editing contact in %j", async (notes, contact_name, expected) => {
  query.single.mockResolvedValueOnce({ data: { id: "artist-a", notes }, error: null })
  expect(await updateArtist("artist-a", { contact_name })).toEqual({ success: true })
  expect(query.update).toHaveBeenCalledWith({ notes: expected })
})

it.each([{ email: "not-an-email" }, { stage_name: "   " }, { fee: -1 }, { fee: Number.NaN }, { fee: Number.POSITIVE_INFINITY }])("rejects invalid artist edit %j before backend access", async (input) => {
  const result = await updateArtist("artist-a", input)
  expect(result.success).toBe(false)
  expect(result.error).toBeTruthy()
  expect(db.from).not.toHaveBeenCalled()
})
it.each([["   ", null], ["  new@example.test  ", "new@example.test"]])("normalizes edit email %j", async (email, expected) => {
  await updateArtist("artist-a", { email: email! })
  expect(query.update).toHaveBeenCalledWith({ email: expected })
})

it("does not report success if the artist disappears between read and scoped update", async () => {
  query.single.mockResolvedValueOnce({ data: { id: "artist-a" }, error: null })
    .mockResolvedValueOnce({ data: null, error: null })
  expect(await updateArtist("artist-a", { phone: "" })).toEqual({ success: false, error: "Artist not found" })
})

it.each(["surname", "location", "phone", "travel_fee", "pricing_notes", "overview", "dj_equipment", "sound_system", "allergies", "special_diet", "special_needs"] as const)("clears supplied empty %s to NULL (action characterization)", async field => {
  await updateArtist("artist-a", { [field]: "" })
  expect(query.update).toHaveBeenCalledWith({ [field]: null })
})
it.each(["social_links", "genres"] as const)("preserves explicit empty %s arrays (action characterization)", async field => {
  await updateArtist("artist-a", { [field]: [] })
  expect(query.update).toHaveBeenCalledWith({ [field]: [] })
})
it("leaves omitted fee, contact notes and other optional fields untouched (characterization)", async () => {
  await updateArtist("artist-a", { stage_name: "DJ New" })
  expect(query.update).toHaveBeenCalledWith({ stage_name: "DJ New" })
})
it("reports a scoped update error without revalidating success", async () => {
  query.single.mockResolvedValueOnce({ data: { id: "artist-a" }, error: null }).mockResolvedValueOnce({ data: null, error: { message: "Save denied" } })
  expect(await updateArtist("artist-a", { phone: "" })).toEqual({ success: false, error: "Save denied" })
})
