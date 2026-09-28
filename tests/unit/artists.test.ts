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
it.each([undefined, "", "   "])("falls back to stage name when real name is %s (characterization)", async (name) => {
  await createArtist({ stage_name: "DJ Moon", name })
  expect(query.insert).toHaveBeenCalledWith(expect.objectContaining({ name: "DJ Moon" }))
})
