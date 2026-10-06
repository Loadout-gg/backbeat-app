import { beforeEach, expect, it, vi } from "vitest"
const mocks = vi.hoisted(() => {
  const result = { data: [{ id: "event-a" }], error: null as { message: string } | null }
  const query = {
    select: vi.fn(), eq: vi.fn(), order: vi.fn(),
    then: (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve),
  }
  return { result, query, from: vi.fn(), createClient: vi.fn(), workspace: vi.fn() }
})
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }))
vi.mock("@/lib/actions/workspace", () => ({ getCurrentWorkspaceId: mocks.workspace }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
import { listEvents } from "@/lib/actions/events"
const artistId = "11111111-1111-4111-8111-111111111111"
beforeEach(() => {
  mocks.result.data = [{ id: "event-a" }]
  mocks.result.error = null
  mocks.workspace.mockResolvedValue("selected-workspace")
  mocks.createClient.mockResolvedValue({ from: mocks.from })
  mocks.from.mockReturnValue(mocks.query)
  for (const fn of [mocks.query.select, mocks.query.eq, mocks.query.order]) fn.mockReturnValue(mocks.query)
})
it("restricts artist events at the database boundary while retaining the authoritative workspace", async () => {
  expect(await listEvents({ artistId })).toEqual([{ id: "event-a" }])
  expect(mocks.query.eq.mock.calls).toEqual([["workspace_id", "selected-workspace"], ["artist_id", artistId]])
  expect(mocks.query.order.mock.calls).toEqual([["date", { ascending: false }], ["created_at", { ascending: false }]])
})
it.each(["", "invalid", "11111111-1111-4111-8111-111111111111 "])("rejects malformed artist filter %j before backend access", async (value) => {
  await expect(listEvents({ artistId: value })).rejects.toThrow("Invalid artist ID")
  expect(mocks.createClient).not.toHaveBeenCalled()
  expect(mocks.workspace).not.toHaveBeenCalled()
})
it("preserves the legacy workspace-wide reader when the filter is omitted (characterization)", async () => {
  expect(await listEvents()).toEqual([{ id: "event-a" }])
  expect(mocks.query.eq.mock.calls).toEqual([["workspace_id", "selected-workspace"]])
})
it("does not convert an event read failure into an empty calendar (characterization)", async () => {
  mocks.result.error = { message: "read failed" }
  await expect(listEvents({ artistId })).rejects.toThrow("read failed")
})
it("does not query events when authoritative workspace resolution fails (characterization)", async () => {
  mocks.workspace.mockRejectedValueOnce(new Error("No active workspace"))
  await expect(listEvents({ artistId })).rejects.toThrow("No active workspace")
  expect(mocks.from).not.toHaveBeenCalled()
})
