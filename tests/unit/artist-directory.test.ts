import { beforeEach, expect, it, vi } from "vitest"
const db = vi.hoisted(() => ({ createClient: vi.fn(), workspace: vi.fn(), from: vi.fn(), select: vi.fn(), eq: vi.fn(), order: vi.fn(), range: vi.fn() }))
vi.mock("@/lib/supabase/server", () => ({ createClient: db.createClient }))
vi.mock("@/lib/actions/workspace", () => ({ getCurrentWorkspaceId: db.workspace }))
import { listArtistDirectory } from "@/lib/actions/artist-directory"
const row = (id: string) => ({ id, name: "Mila", surname: null, stage_name: "Aurora", genres: [], location: null, fee: null, currency: null })
it("projects explicit fields and normalizes nullable values without leaking private columns", async () => {
  db.range.mockResolvedValue({ data: [{ id: "a", name: null, notes: "private", email: "private", allergies: "private", genres: null, fee: 0 }], count: 1, error: null })
  expect(await listArtistDirectory()).toEqual([{ id: "a", name: null, surname: null, stage_name: null, genres: [], location: null, fee: 0, currency: null }])
})
it("propagates database errors instead of returning a false empty roster", async () => {
  db.range.mockResolvedValue({ data: null, count: null, error: { message: "read denied" } })
  await expect(listArtistDirectory()).rejects.toThrow("read denied")
})
it.each([null, undefined, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "1"])("rejects invalid exact count %s", async (count) => {
  db.range.mockResolvedValue({ data: [], count, error: null })
  await expect(listArtistDirectory()).rejects.toThrow("count")
})
it.each([200, 73])("reads all 405 entries with provider cap %s and advances by actual rows", async (cap) => {
  const rows = Array.from({ length: 405 }, (_, i) => row(String(i).padStart(4, "0")))
  db.range.mockImplementation((from: number, to: number) => Promise.resolve({ data: rows.slice(from, Math.min(to + 1, from + cap)), count: rows.length, error: null }))
  expect(await listArtistDirectory()).toEqual(rows)
  expect(db.range.mock.calls.map(([from, to]) => [from, to])).toEqual(Array.from({ length: Math.ceil(405 / cap) }, (_, i) => [i * cap, i * cap + 199]))
  expect(db.select).toHaveBeenCalledTimes(Math.ceil(405 / cap))
  expect(db.eq.mock.calls.every(([column, value]) => column === "workspace_id" && value === "workspace-a")).toBe(true)
})
it("rejects count drift rather than returning partial success", async () => {
  db.range.mockResolvedValueOnce({ data: [row("a")], count: 2, error: null })
    .mockResolvedValueOnce({ data: [row("b")], count: 1, error: null })
  await expect(listArtistDirectory()).rejects.toThrow("count")
})
it("rejects a premature empty page immediately", async () => {
  db.range.mockResolvedValueOnce({ data: [row("a")], count: 2, error: null })
    .mockResolvedValueOnce({ data: [], count: 2, error: null })
    .mockResolvedValueOnce({ data: [row("b")], count: 2, error: null })
  await expect(listArtistDirectory()).rejects.toThrow("incomplete")
  expect(db.range).toHaveBeenCalledTimes(2)
})
it.each(["same batch", "later batch"])("rejects duplicate IDs in %s", async (where) => {
  if (where === "same batch") db.range.mockResolvedValue({ data: [row("a"), row("a")], count: 2, error: null })
  else db.range.mockResolvedValueOnce({ data: [row("a")], count: 2, error: null }).mockResolvedValueOnce({ data: [row("a")], count: 2, error: null })
  await expect(listArtistDirectory()).rejects.toThrow("duplicate")
})
it.each(["oversized", "final mismatch"])("rejects %s responses", async (kind) => {
  const data = Array.from({ length: kind === "oversized" ? 201 : 2 }, (_, i) => row(String(i)))
  db.range.mockResolvedValue({ data, count: kind === "oversized" ? 201 : 1, error: null })
  await expect(listArtistDirectory()).rejects.toThrow("inconsistent")
})
it.each([{ id: "" }, { id: null }, { name: 42 }, { genres: "House" }, { genres: [null] }, { fee: "100" }, { fee: Infinity }])("rejects inconsistent row fields %j", async (change) => {
  db.range.mockResolvedValue({ data: [{ ...row("a"), ...change }], count: 1, error: null })
  await expect(listArtistDirectory()).rejects.toThrow("Invalid artist directory row")
})
it("accepts an exactly counted empty workspace", async () => {
  db.range.mockResolvedValue({ data: [], count: 0, error: null })
  expect(await listArtistDirectory()).toEqual([])
  expect(db.range).toHaveBeenCalledOnce()
})
it("propagates a later batch failure without yielding partial rows", async () => {
  db.range.mockResolvedValueOnce({ data: [row("a")], count: 2, error: null })
    .mockResolvedValueOnce({ data: null, count: null, error: { message: "later failure" } })
  await expect(listArtistDirectory()).rejects.toThrow("later failure")
})
it("does not query artists when workspace resolution fails", async () => {
  db.workspace.mockRejectedValue(new Error("workspace unavailable"))
  await expect(listArtistDirectory()).rejects.toThrow("workspace unavailable")
  expect(db.from).not.toHaveBeenCalled()
})
it("rejects a missing second count", async () => {
  db.range.mockResolvedValueOnce({ data: [row("a")], count: 2, error: null })
    .mockResolvedValueOnce({ data: [row("b")], count: null, error: null })
  await expect(listArtistDirectory()).rejects.toThrow("count")
})
it("rejects null data even if the count claims an empty workspace", async () => {
  db.range.mockResolvedValue({ data: null, count: 0, error: null })
  await expect(listArtistDirectory()).rejects.toThrow("incomplete")
})
beforeEach(() => {
  vi.resetAllMocks()
  db.createClient.mockResolvedValue(db)
  db.workspace.mockResolvedValue("workspace-a")
  for (const method of [db.from, db.select, db.eq, db.order]) method.mockReturnValue(db)
})
it("reads only the directory projection for the authoritative workspace", async () => {
  db.range.mockResolvedValue({ data: [row("a")], count: 1, error: null })
  expect(await listArtistDirectory()).toEqual([row("a")])
  expect(db.createClient).toHaveBeenCalledOnce()
  expect(db.workspace).toHaveBeenCalledOnce()
  expect(db.from).toHaveBeenCalledWith("artists")
  expect(db.select).toHaveBeenCalledWith("id,name,surname,stage_name,genres,location,fee,currency", { count: "exact" })
  expect(db.eq).toHaveBeenCalledWith("workspace_id", "workspace-a")
  expect(db.order).toHaveBeenCalledWith("id", { ascending: true })
  expect(db.range).toHaveBeenCalledWith(0, 199)
})
