// LIFE-02 / LIFE-09 / AUD-04 (LOCAL_INPROCESS): the operator scripts against a mocked client.
// The state machine they drive is executed in tests/sql/travel-documents.sql; no real object is
// removed by these tests.
import { expect, it, vi } from "vitest"
import { BUCKET, parseArgs, resolveTarget, runPurge } from "@/ops/supabase/booking-travel/purge-travel-documents.mjs"
import { parseArgs as parseAuditArgs, runAuditRetention } from "@/ops/supabase/booking-travel/purge-travel-audit.mjs"

type Item = { file_id: string; object_key: string; kind: string }
function fakeClient(initial: Item[], options: { failRemove?: string[]; lingering?: string[]; refuseConfirm?: string[] } = {}) {
  let worklist = [...initial]
  const present = new Set(initial.map(item => item.object_key))
  const calls: string[] = []
  const storage = {
    remove: vi.fn(async (keys: string[]) => {
      calls.push(`remove:${keys.join("+")}`)
      if (keys.some(key => options.failRemove?.includes(key))) return { data: null, error: { status: 500, message: "boom" } }
      for (const key of keys) if (!options.lingering?.includes(key)) present.delete(key)
      return { data: [], error: null }
    }),
    info: vi.fn(async (key: string) => present.has(key)
      ? { data: { name: key }, error: null } : { data: null, error: { status: 400, statusCode: "404", message: "Object not found" } }),
    list: vi.fn(), emptyBucket: vi.fn(),
  }
  const rpc = vi.fn(async (name: string, args?: Record<string, unknown>) => {
    const short = name.replace("backbeat_travel_document_", "")
    calls.push(short)
    if (short === "purge_due") return { data: [{ due_documents: 1, due_objects: initial.length, claimed_objects: 0, never_admitted: 0 }], error: null }
    if (short === "purge_claim") return { data: initial.filter(item => item.kind === "purge_pending").length, error: null }
    if (short === "cleanup_claim") return { data: initial.filter(item => item.kind === "cleanup_pending").length, error: null }
    if (short === "purge_worklist") return { data: worklist.map(item => ({ ...item })), error: null }
    if (short === "purge_confirm") {
      const id = args!.p_file_id as string
      if (options.refuseConfirm?.includes(id)) return { data: null, error: { code: "BB015" } }
      worklist = worklist.filter(item => item.file_id !== id)
      return { data: "purged", error: null }
    }
    throw new Error(`unexpected ${name}`)
  })
  return { client: { rpc, storage: { from: vi.fn(() => storage) } } as never, rpc, storage, calls, drop: (id: string) => { worklist = worklist.filter(item => item.file_id !== id) } }
}
const items: Item[] = [
  { file_id: "f1", object_key: "ws/a/d/f1/k", kind: "purge_pending" },
  { file_id: "f2", object_key: "ws/a/d/f2/k", kind: "purge_pending" },
]

it("LIFE-02 default is a dry run: counts only, nothing claimed, nothing removed", async () => {
  const fake = fakeClient(items)
  const summary = await runPurge(fake.client)
  expect(summary).toMatchObject({ execute: false, claimed: 0, confirmed: [], failed: [] })
  expect(fake.calls).toEqual(["purge_due"])
  expect(fake.storage.remove).not.toHaveBeenCalled()
  expect(parseArgs(["--target", "hosted:abcdefghijklmnopqrst"]).execute).toBe(false)
})

it("LIFE-02 execute: claim, then per object re-read, remove that exact key, check absence, confirm", async () => {
  const fake = fakeClient(items)
  const summary = await runPurge(fake.client, { execute: true })
  expect(summary).toMatchObject({ claimed: 2, confirmed: ["f1", "f2"], failed: [], skipped: [], remaining: 0 })
  expect(fake.calls).toEqual(["purge_due", "purge_claim", "purge_worklist",
    "purge_worklist", "remove:ws/a/d/f1/k", "purge_confirm", "purge_worklist", "remove:ws/a/d/f2/k", "purge_confirm", "purge_worklist"])
  expect(fake.storage.remove.mock.calls.every(call => call[0].length === 1)).toBe(true)
  expect(fake.rpc).toHaveBeenCalledWith("backbeat_travel_document_purge_confirm", { p_file_id: "f1", p_bucket: BUCKET })
  expect(fake.storage.list).not.toHaveBeenCalled()
  expect(fake.storage.emptyBucket).not.toHaveBeenCalled()
})

it("LIFE-02 partial failure: a failed remove is not confirmed and stays in the workset for the retry", async () => {
  const fake = fakeClient(items, { failRemove: ["ws/a/d/f1/k"] })
  const summary = await runPurge(fake.client, { execute: true })
  expect(summary).toMatchObject({ confirmed: ["f2"], failed: [{ fileId: "f1", step: "remove" }], remaining: 1 })
  expect(fake.rpc).not.toHaveBeenCalledWith("backbeat_travel_document_purge_confirm", { p_file_id: "f1", p_bucket: BUCKET })
  // Second run (new process): the claim is idempotent and the leftover object converges.
  const retry = fakeClient([items[0]])
  expect(await runPurge(retry.client, { execute: true })).toMatchObject({ confirmed: ["f1"], failed: [], remaining: 0 })
})

it("LIFE-02 success without acknowledgement: remove reported OK but the object is still there -> not confirmed", async () => {
  const fake = fakeClient(items, { lingering: ["ws/a/d/f2/k"] })
  const summary = await runPurge(fake.client, { execute: true })
  expect(summary).toMatchObject({ confirmed: ["f1"], failed: [{ fileId: "f2", step: "still present or unknown" }] })
})

it("LIFE-02 the database has the last word: a refused confirm (catalog still lists the key) is a failure, not a success", async () => {
  const fake = fakeClient(items, { refuseConfirm: ["f1"] })
  const summary = await runPurge(fake.client, { execute: true })
  expect(summary.confirmed).toEqual(["f2"])
  expect(summary.failed).toEqual([{ fileId: "f1", step: "purge_confirm failed (BB015)" }])
})

it("LIFE-09 a stale workset entry (no longer claimed when re-read) is never removed", async () => {
  const fake = fakeClient(items)
  let reads = 0
  const original = fake.rpc.getMockImplementation()!
  fake.rpc.mockImplementation(async (name: string, args?: Record<string, unknown>) => {
    if (name.endsWith("purge_worklist") && ++reads === 2) fake.drop("f1")   // gone between snapshot and act
    return original(name, args)
  })
  const summary = await runPurge(fake.client, { execute: true })
  expect(summary).toMatchObject({ skipped: ["f1"], confirmed: ["f2"], failed: [] })
  expect(fake.storage.remove).not.toHaveBeenCalledWith(["ws/a/d/f1/k"])
})

it("LIFE-03 never-admitted reservations are cleaned only when separately requested", async () => {
  const mixed: Item[] = [...items, { file_id: "q1", object_key: "ws/a/d/q1/k", kind: "cleanup_pending" }]
  const plain = fakeClient(mixed)
  const first = await runPurge(plain.client, { execute: true })
  expect(first).toMatchObject({ confirmed: ["f1", "f2"], skipped: ["q1"] })
  expect(plain.calls).not.toContain("cleanup_claim")
  expect(plain.storage.remove).not.toHaveBeenCalledWith(["ws/a/d/q1/k"])
  const cleanup = fakeClient(mixed)
  expect(await runPurge(cleanup.client, { execute: true, includeNeverAdmitted: true, minAgeHours: 48 })).toMatchObject({ confirmed: ["f1", "f2", "q1"], claimed: 3 })
  expect(cleanup.rpc).toHaveBeenCalledWith("backbeat_travel_document_cleanup_claim", { p_min_age: "48 hours" })
})

it("LIFE-02 / AUD-04 explicit target must name the project in SUPABASE_URL; unknown flags are refused", () => {
  expect(resolveTarget("hosted:abcdefghijklmnopqrst", "https://abcdefghijklmnopqrst.supabase.co")).toBe("hosted:abcdefghijklmnopqrst")
  expect(resolveTarget("hosted:abcdefghijklmnopqrst", "https://zzzzzzzzzzzzzzzzzzzz.supabase.co")).toBeNull()
  expect(resolveTarget(null, "https://abcdefghijklmnopqrst.supabase.co")).toBeNull()
  expect(resolveTarget("hosted:abcdefghijklmnopqrst", "not a url")).toBeNull()
  expect(resolveTarget("local", "http://127.0.0.1:55322")).toBe("local")
  expect(resolveTarget("local", "https://abcdefghijklmnopqrst.supabase.co")).toBeNull()
  expect(() => parseArgs(["--force"])).toThrow("Unknown argument")
  expect(() => parseArgs(["--min-age-hours", "2"])).toThrow("at least 3")
  expect(parseArgs(["--min-age-hours", "3"]).minAgeHours).toBe(3)
})

it("AUD-04 audit retention: nothing is called without --execute; with it, one bounded database call", async () => {
  const rpc = vi.fn(async () => ({ data: 7, error: null }))
  const client = { rpc } as never
  expect(await runAuditRetention(client, { before: "2024-11-27T00:00:00Z" })).toEqual({ execute: false, before: "2024-11-27T00:00:00Z", removed: null })
  expect(rpc).not.toHaveBeenCalled()
  expect(await runAuditRetention(client, { before: "2024-11-27T00:00:00Z", execute: true })).toEqual({ execute: true, before: "2024-11-27T00:00:00Z", removed: 7 })
  expect(rpc).toHaveBeenCalledExactlyOnceWith("backbeat_travel_document_audit_retention_purge", { p_before: "2024-11-27T00:00:00Z" })
  rpc.mockResolvedValueOnce({ data: null, error: { code: "BB021" } } as never)
  await expect(runAuditRetention(client, { before: "2026-11-01T00:00:00Z", execute: true })).rejects.toThrow("younger than 24 calendar months")
  expect(() => parseAuditArgs(["--target", "local"])).toThrow("--before")
  expect(() => parseAuditArgs(["--target", "local", "--before", "last year"])).toThrow("--before")
  expect(parseAuditArgs(["--target", "local", "--before", "2024-11-27T00:00:00Z"]).execute).toBe(false)
})
