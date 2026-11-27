import { beforeEach, expect, it, vi } from "vitest"
const db = vi.hoisted(() => ({ createClient: vi.fn(), workspace: vi.fn(), from: vi.fn(), select: vi.fn(), eq: vi.fn(), order: vi.fn(), range: vi.fn() }))
vi.mock("@/lib/supabase/server", () => ({ createClient: db.createClient }))
vi.mock("@/lib/actions/workspace", () => ({ getCurrentWorkspaceId: db.workspace }))
import { exportArtistsCsv } from "@/lib/actions/artist-export"
import { ARTIST_EXPORT_ERROR, ARTIST_EXPORT_SELECT } from "@/lib/artist-csv"

const row = (id: string) => ({ id, name: "Mila", stage_name: `Act ${id}`, genres: [], fee: null, social_links: [], documents: [] })
beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllEnvs()
  const query = { select: db.select, eq: db.eq, order: db.order, range: db.range }
  for (const fn of [db.select, db.eq, db.order]) fn.mockReturnValue(query)
  db.from.mockReturnValue(query)
  db.createClient.mockResolvedValue({ from: db.from })
  db.workspace.mockResolvedValue("workspace-a")
})

it("reads every artist of the current workspace with the explicit column list", async () => {
  vi.stubEnv("BACKBEAT_CALENDAR_TIME_ZONE", "UTC")
  const rows = Array.from({ length: 250 }, (_, i) => row(String(i).padStart(3, "0")))
  db.range.mockImplementation((from: number, to: number) => Promise.resolve({ data: rows.slice(from, to + 1), count: rows.length, error: null }))
  const result = await exportArtistsCsv()
  expect(result.success).toBe(true)
  if (!result.success) return
  expect(result.count).toBe(250)
  expect(result.fileName).toMatch(/^artists-\d{4}-\d{2}-\d{2}\.csv$/)
  expect(result.csv.split("\r\n")).toHaveLength(252)
  expect(db.from).toHaveBeenCalledWith("artists")
  expect(db.select.mock.calls.every(([columns]) => columns === ARTIST_EXPORT_SELECT)).toBe(true)
  expect(ARTIST_EXPORT_SELECT).not.toContain("workspace_id")
  expect(ARTIST_EXPORT_SELECT).not.toContain("*")
  expect(db.eq.mock.calls.every(([column, value]) => column === "workspace_id" && value === "workspace-a")).toBe(true)
})

it("returns an empty export for an exactly counted empty workspace", async () => {
  db.range.mockResolvedValue({ data: [], count: 0, error: null })
  expect(await exportArtistsCsv()).toMatchObject({ success: true, count: 0 })
})

it.each([
  ["provider error", { data: null, count: null, error: { message: "permission denied for table artists" } }],
  ["incomplete read", { data: [row("a")], count: 2, error: null }],
  ["invalid row", { data: [{ ...row("a"), fee: "free" }], count: 1, error: null }],
])("returns fixed copy on %s, never the provider message", async (_label, response) => {
  db.range.mockResolvedValueOnce(response).mockResolvedValue({ data: [], count: 2, error: null })
  const result = await exportArtistsCsv()
  expect(result).toEqual({ success: false, error: ARTIST_EXPORT_ERROR })
  expect(JSON.stringify(result)).not.toContain("permission")
})

it("lets the workspace redirect propagate", async () => {
  const redirect = Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace;/onboarding;307;" })
  db.workspace.mockRejectedValue(redirect)
  await expect(exportArtistsCsv()).rejects.toBe(redirect)
})
