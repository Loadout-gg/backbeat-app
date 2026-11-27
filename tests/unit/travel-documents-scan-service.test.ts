// LOCAL_INPROCESS evidence for the trusted server path of travel-document scans. Supabase Auth,
// PostgREST and Storage are mocks: the order of calls, what is sent and what is released are
// asserted here; the database half of each contract is executed in tests/sql/travel-documents.sql.
// Test names start with the verification-plan ID (owner decision on PR #36).
import { beforeEach, expect, it, vi } from "vitest"

const h = vi.hoisted(() => {
  const storage = { createSignedUrl: vi.fn(), createSignedUploadUrl: vi.fn(), download: vi.fn(), remove: vi.fn(), list: vi.fn() }
  return {
    calls: [] as string[],
    storage,
    user: { auth: { getUser: vi.fn() }, from: vi.fn(), rpc: vi.fn() },
    admin: { rpc: vi.fn(), storage: { from: vi.fn(() => storage) }, from: vi.fn() },
    env: { enabled: true, key: true },
    workspace: vi.fn(async () => "ws-selected"),
  }
})
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => h.user) }))
vi.mock("@/lib/actions/workspace", () => ({ getCurrentWorkspaceId: h.workspace }))
vi.mock("@/lib/supabase/privileged", () => ({
  travelDocumentScansEnabled: () => h.env.enabled,
  createPrivilegedClient: () => {
    h.calls.push("privileged-client")
    return h.env.enabled && h.env.key ? h.admin : null
  },
}))
import { finalizeScanUpload, issueScanDownload, reserveScanUpload } from "@/lib/travel-documents/scan-service"

const FILE = "11111111-1111-4111-8111-111111111111"
const DOC = "22222222-2222-4222-8222-222222222222"
const BOOKING = "33333333-3333-4333-8333-333333333333"
const KEY = "ws/artist/doc/file/5c0e2f0e-secret-key"
const LINK = "https://project.supabase.co/storage/v1/object/sign/artist-travel-documents/x?token=SIGNED-TOKEN"
const grant = { object_key: KEY, document_generation: 4, media_type: "application/pdf", doc_type: "passport" }
const pdf = (size = 64) => { const bytes = new Uint8Array(size); bytes.set([0x25, 0x50, 0x44, 0x46, 0x2d]); return bytes }
const blob = (bytes: Uint8Array) => ({ arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) })
const deferred = <T,>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
type Rpc = (name: string, args: Record<string, unknown>) => unknown
/** Routes privileged calls by function name and records the order of everything. */
function onRpc(handlers: Record<string, Rpc>) {
  h.admin.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
    h.calls.push(name.replace("backbeat_travel_document_", "rpc:"))
    const handler = handlers[name.replace("backbeat_travel_document_", "")]
    if (!handler) throw new Error(`unexpected rpc ${name}`)
    return handler(name, args)
  })
}
const rpcArgs = (short: string) => h.admin.rpc.mock.calls.filter(call => call[0] === `backbeat_travel_document_${short}`).map(call => call[1])

beforeEach(() => {
  h.calls.length = 0
  h.env.enabled = true
  h.env.key = true
  h.workspace.mockReset().mockImplementation(async () => { h.calls.push("workspace"); return "ws-selected" })
  h.user.auth.getUser.mockReset().mockImplementation(async () => { h.calls.push("session"); return { data: { user: { id: "user-a" } }, error: null } })
  h.admin.rpc.mockReset()
  for (const fn of Object.values(h.storage)) fn.mockReset()
  h.storage.createSignedUrl.mockImplementation(async () => { h.calls.push("sign"); return { data: { signedUrl: LINK }, error: null } })
  h.storage.createSignedUploadUrl.mockImplementation(async () => { h.calls.push("sign-upload"); return { data: { signedUrl: "https://project.supabase.co/upload?token=UP", token: "UP", path: KEY }, error: null } })
  h.storage.download.mockImplementation(async () => { h.calls.push("read-bytes"); return { data: blob(pdf()), error: null } })
})

it("CORE-04 / URL-01 session, then one committed authorization, then the signer, then the fence, then the link", async () => {
  onRpc({ authorize_download: () => ({ data: [grant], error: null }), record_issuance: () => ({ data: true, error: null }) })
  expect(await issueScanDownload({ fileId: FILE, bookingId: BOOKING })).toEqual({ ok: true, url: LINK })
  expect(h.calls).toEqual(["session", "workspace", "privileged-client", "rpc:authorize_download", "sign", "rpc:record_issuance"])
  const [auth] = rpcArgs("authorize_download")
  expect(auth).toEqual({
    p_actor: "user-a", p_workspace_id: "ws-selected", p_file_id: FILE, p_request_id: expect.stringMatching(/^[0-9a-f-]{36}$/),
    p_booking_id: BOOKING, p_event_id: null,
  })
  expect(rpcArgs("record_issuance")).toEqual([{
    p_actor: "user-a", p_workspace_id: "ws-selected", p_file_id: FILE, p_request_id: auth.p_request_id, p_generation: 4, p_signed: true,
  }])
  // Exact version, fixed 60 s TTL, attachment with a name that carries no personal data.
  expect(h.storage.createSignedUrl).toHaveBeenCalledExactlyOnceWith(KEY, 60, { download: "passport-scan.pdf" })
  expect(h.admin.storage.from).toHaveBeenCalledWith("artist-travel-documents")
})

it("CORE-06 no context is a valid request: nothing is invented, no reason exists anywhere in the call", async () => {
  onRpc({ authorize_download: () => ({ data: [grant], error: null }), record_issuance: () => ({ data: true, error: null }) })
  expect((await issueScanDownload({ fileId: FILE })).ok).toBe(true)
  expect(rpcArgs("authorize_download")[0]).toMatchObject({ p_booking_id: null, p_event_id: null })
  expect(JSON.stringify(h.admin.rpc.mock.calls)).not.toMatch(/reason|ttl|expires/i)
})

it.each([
  ["flag off", () => { h.env.enabled = false }, "disabled", [] as string[]],
  ["no session", () => { h.user.auth.getUser.mockResolvedValue({ data: { user: null }, error: null }) }, "unauthenticated", []],
  ["CORE-03 invalid / expired / revoked session (Auth server says no)", () => { h.user.auth.getUser.mockResolvedValue({ data: { user: null }, error: { message: "session_not_found" } }) }, "unauthenticated", []],
  ["CORE-03 no active membership in the selected workspace", () => { h.workspace.mockRejectedValue(new Error("No active workspace membership")) }, "not_allowed", []],
  ["server credential not configured", () => { h.env.key = false }, "unavailable", ["privileged-client"]],
])("CORE-05 / ACL-04 %s: no privileged call, no signer, no link", async (_label, arrange, failure, allowed) => {
  arrange()
  onRpc({})
  expect(await issueScanDownload({ fileId: FILE })).toEqual({ ok: false, failure })
  expect(await reserveScanUpload(DOC)).toEqual({ ok: false, failure })
  expect(await finalizeScanUpload(FILE)).toEqual({ ok: false, failure })
  expect(h.admin.rpc).not.toHaveBeenCalled()
  expect(h.storage.createSignedUrl).not.toHaveBeenCalled()
  expect(h.storage.createSignedUploadUrl).not.toHaveBeenCalled()
  expect(h.storage.download).not.toHaveBeenCalled()
  expect(h.calls.filter(call => call === "privileged-client")).toHaveLength(allowed.length * 3)
})

it.each([
  ["BB013", "not_allowed"], ["BB014", "not_found"], ["BB015", "not_allowed"], ["BB017", "invalid_context"], ["XX000", "unavailable"],
])("CORE-05 authorization refused or failed (%s): no signer call, no link, sanitized result", async (code, failure) => {
  onRpc({ authorize_download: () => ({ data: null, error: { code, message: `denied for key ${KEY}` } }) })
  const log = vi.spyOn(console, "error").mockImplementation(() => {})
  try {
    expect(await issueScanDownload({ fileId: FILE, bookingId: BOOKING })).toEqual({ ok: false, failure })
    expect(h.storage.createSignedUrl).not.toHaveBeenCalled()
    expect(rpcArgs("record_issuance")).toEqual([])
    expect(JSON.stringify(log.mock.calls)).not.toContain(KEY)
    expect(log.mock.calls[0][1]).toEqual({ code })
  } finally { log.mockRestore() }
})

it("CORE-05 a rejected privileged call (network / database down) releases nothing", async () => {
  h.admin.rpc.mockRejectedValue(new Error("fetch failed"))
  await expect(issueScanDownload({ fileId: FILE })).rejects.toThrow()
  expect(h.storage.createSignedUrl).not.toHaveBeenCalled()
})

it("CORE-07 signer failure: recorded as not signed, never a link; the next request is a fresh authorization", async () => {
  onRpc({
    authorize_download: () => ({ data: [grant], error: null }),
    record_issuance: (_name, args) => ({ data: args.p_signed === true, error: null }),
  })
  h.storage.createSignedUrl.mockResolvedValueOnce({ data: null, error: { message: "signer down" } })
  expect(await issueScanDownload({ fileId: FILE })).toEqual({ ok: false, failure: "unavailable" })
  h.storage.createSignedUrl.mockRejectedValueOnce(new Error("timeout"))
  expect(await issueScanDownload({ fileId: FILE })).toEqual({ ok: false, failure: "unavailable" })
  expect((await issueScanDownload({ fileId: FILE })).ok).toBe(true)
  expect(rpcArgs("record_issuance").map(args => args.p_signed)).toEqual([false, false, true])
  const ids = rpcArgs("authorize_download").map(args => args.p_request_id)
  expect(new Set(ids).size).toBe(3)
  expect(rpcArgs("record_issuance").map(args => args.p_request_id)).toEqual(ids)
})

it("CORE-07 unknown outcome (the outcome call fails after a good signature): the link is not released", async () => {
  onRpc({ authorize_download: () => ({ data: [grant], error: null }), record_issuance: () => ({ data: null, error: { code: "57014" } }) })
  const log = vi.spyOn(console, "error").mockImplementation(() => {})
  try {
    expect(await issueScanDownload({ fileId: FILE })).toEqual({ ok: false, failure: "unavailable" })
    expect(JSON.stringify(log.mock.calls)).not.toContain("SIGNED-TOKEN")
  } finally { log.mockRestore() }
})

// Deterministic barriers: the signer is held open while the "archive" happens, and the fence
// answers according to the generation it sees when it finally runs.
it("CORE-08 barrier, archive wins: a request authorized at generation 4 gets no link once the card moved on", async () => {
  let generation = 4
  onRpc({
    authorize_download: () => ({ data: [{ ...grant, document_generation: generation }], error: null }),
    record_issuance: (_name, args) => ({ data: args.p_signed === true && args.p_generation === generation, error: null }),
  })
  const signer = deferred<{ data: { signedUrl: string }; error: null }>()
  h.storage.createSignedUrl.mockImplementationOnce(() => { h.calls.push("sign"); return signer.promise })
  const pending = issueScanDownload({ fileId: FILE })
  await vi.waitFor(() => expect(h.calls).toContain("sign"))
  expect(rpcArgs("record_issuance")).toEqual([])            // barrier: authorized, signer open, nothing released
  generation = 5                                            // archive / restore committed meanwhile
  signer.resolve({ data: { signedUrl: LINK }, error: null })
  expect(await pending).toEqual({ ok: false, failure: "not_allowed" })
  expect(rpcArgs("record_issuance")[0]).toMatchObject({ p_generation: 4, p_signed: true })
})

it("CORE-08 barrier, release wins: the fence passed before the archive, so the link is an old capability, not a new grant", async () => {
  let generation = 4
  const fence = deferred<void>()
  onRpc({
    authorize_download: () => ({ data: [{ ...grant, document_generation: generation }], error: null }),
    record_issuance: async (_name, args) => {
      const verdict = args.p_signed === true && args.p_generation === generation   // decided now
      fence.resolve()
      return { data: verdict, error: null }
    },
  })
  const first = issueScanDownload({ fileId: FILE })
  await fence.promise
  generation = 5                                            // the archive commits after the fence decided
  expect(await first).toEqual({ ok: true, url: LINK })
  // A new ordinary request after the state change is re-authorized by the database, which refuses.
  onRpc({ authorize_download: () => ({ data: null, error: { code: "BB015" } }) })
  const log = vi.spyOn(console, "error").mockImplementation(() => {})
  try {
    expect(await issueScanDownload({ fileId: FILE })).toEqual({ ok: false, failure: "not_allowed" })
  } finally { log.mockRestore() }
  expect(h.storage.createSignedUrl).toHaveBeenCalledTimes(1)
})

it("URL-01 nothing sensitive is logged on success or failure: no key, link, token or bytes", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {})
  const info = vi.spyOn(console, "log").mockImplementation(() => {})
  try {
    onRpc({ authorize_download: () => ({ data: [grant], error: null }), record_issuance: () => ({ data: false, error: null }) })
    await issueScanDownload({ fileId: FILE })
    onRpc({ authorize_download: () => ({ data: [grant], error: null }), record_issuance: () => ({ data: true, error: null }) })
    await issueScanDownload({ fileId: FILE })
    const logged = JSON.stringify([...log.mock.calls, ...info.mock.calls])
    expect(logged).not.toContain(KEY)
    expect(logged).not.toContain("SIGNED-TOKEN")
  } finally { log.mockRestore(); info.mockRestore() }
})

it("URL-01 a malformed grant (no key, unknown type) is never signed", async () => {
  onRpc({ authorize_download: () => ({ data: [{ ...grant, media_type: "image/svg+xml" }], error: null }) })
  expect(await issueScanDownload({ fileId: FILE })).toEqual({ ok: false, failure: "unavailable" })
  onRpc({ authorize_download: () => ({ data: [], error: null }) })
  expect(await issueScanDownload({ fileId: FILE })).toEqual({ ok: false, failure: "unavailable" })
  expect(h.storage.createSignedUrl).not.toHaveBeenCalled()
})

it("LIFE-07 scan of a restored card: bytes are verified against the recorded digest first, then a fresh request is authorized", async () => {
  let verified = false
  onRpc({
    authorize_download: () => verified ? { data: [grant], error: null } : { data: null, error: { code: "BB020" } },
    restore_probe: () => ({ data: KEY, error: null }),
    confirm_restored_file: () => { verified = true; return { data: "ready", error: null } },
    record_issuance: () => ({ data: true, error: null }),
  })
  expect(await issueScanDownload({ fileId: FILE })).toEqual({ ok: true, url: LINK })
  expect(h.calls.slice(3)).toEqual(["rpc:authorize_download", "rpc:restore_probe", "read-bytes", "rpc:confirm_restored_file", "rpc:authorize_download", "sign", "rpc:record_issuance"])
  const [confirm] = rpcArgs("confirm_restored_file")
  expect(confirm).toMatchObject({ p_actor: "user-a", p_workspace_id: "ws-selected", p_file_id: FILE, p_observed_size: 64 })
  expect(confirm.p_observed_sha256).toMatch(/^[0-9a-f]{64}$/)
  const ids = rpcArgs("authorize_download").map(args => args.p_request_id)
  expect(ids[0]).not.toBe(ids[1])
})

it("LIFE-06 / LIFE-07 restored card whose object is gone: reported absent, marked missing, never signed", async () => {
  onRpc({
    authorize_download: () => ({ data: null, error: { code: "BB020" } }),
    restore_probe: () => ({ data: KEY, error: null }),
    confirm_restored_file: () => ({ data: "missing", error: null }),
  })
  h.storage.download.mockResolvedValueOnce({ data: null, error: { status: 400, statusCode: "404", message: "Object not found" } })
  expect(await issueScanDownload({ fileId: FILE })).toEqual({ ok: false, failure: "missing_file" })
  expect(rpcArgs("confirm_restored_file")[0]).toMatchObject({ p_observed_size: null, p_observed_sha256: null })
  expect(h.storage.createSignedUrl).not.toHaveBeenCalled()
})

it("LIFE-06 a transient Storage error during verification decides nothing (not missing, not ready)", async () => {
  onRpc({ authorize_download: () => ({ data: null, error: { code: "BB020" } }), restore_probe: () => ({ data: KEY, error: null }) })
  h.storage.download.mockResolvedValueOnce({ data: null, error: { status: 503, message: "upstream unavailable" } })
  expect(await issueScanDownload({ fileId: FILE })).toEqual({ ok: false, failure: "unavailable" })
  expect(rpcArgs("confirm_restored_file")).toEqual([])
})

it("FILE-01 / LIFE-03 reserve: pending version first, then a create-only upload link for its allocated key", async () => {
  onRpc({ reserve_upload: () => ({ data: [{ file_id: FILE, object_key: KEY }], error: null }) })
  expect(await reserveScanUpload(DOC)).toEqual({ ok: true, fileId: FILE, uploadUrl: "https://project.supabase.co/upload?token=UP" })
  expect(h.calls.slice(3)).toEqual(["rpc:reserve_upload", "sign-upload"])
  expect(rpcArgs("reserve_upload")).toEqual([{ p_actor: "user-a", p_workspace_id: "ws-selected", p_document_id: DOC }])
  // No upsert option: the link cannot replace existing bytes.
  expect(h.storage.createSignedUploadUrl).toHaveBeenCalledExactlyOnceWith(KEY)
})

it("FILE-01 reserve refused (archived card, non-member) or signer down: no upload link", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {})
  try {
    onRpc({ reserve_upload: () => ({ data: null, error: { code: "BB015" } }) })
    expect(await reserveScanUpload(DOC)).toEqual({ ok: false, failure: "not_allowed" })
    expect(h.storage.createSignedUploadUrl).not.toHaveBeenCalled()
    onRpc({ reserve_upload: () => ({ data: [{ file_id: FILE, object_key: KEY }], error: null }) })
    h.storage.createSignedUploadUrl.mockResolvedValueOnce({ data: null, error: { message: "Bucket not found" } })
    expect(await reserveScanUpload(DOC)).toEqual({ ok: false, failure: "unavailable" })
  } finally { log.mockRestore() }
})

it("FILE-01 finalize: the stored bytes decide; type, size and digest are observed on the server", async () => {
  onRpc({ pending_key: () => ({ data: KEY, error: null }), finalize_upload: () => ({ data: "ready", error: null }) })
  const bytes = pdf(1000)
  h.storage.download.mockImplementationOnce(async () => { h.calls.push("read-bytes"); return { data: blob(bytes), error: null } })
  expect(await finalizeScanUpload(FILE)).toEqual({ ok: true })
  expect(h.calls.slice(3)).toEqual(["rpc:pending_key", "read-bytes", "rpc:finalize_upload"])
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), b => b.toString(16).padStart(2, "0")).join("")
  expect(rpcArgs("finalize_upload")).toEqual([{
    p_actor: "user-a", p_workspace_id: "ws-selected", p_file_id: FILE,
    p_media_type: "application/pdf", p_byte_size: 1000, p_sha256: digest, p_reject_reason: null,
  }])
})

it.each([
  ["a script renamed to .pdf (declared type is irrelevant)", new TextEncoder().encode("<script>alert(1)</script>"), "invalid_bytes"],
  ["an SVG", new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" onload="x()"/>'), "invalid_bytes"],
  ["an empty object", new Uint8Array(0), "invalid_bytes"],
  ["10 MB + 1 byte of PDF", pdf(10 * 1024 * 1024 + 1), "invalid_bytes"],
])("FILE-01 finalize rejects %s: recorded as never admitted, not servable", async (_label, bytes, reason) => {
  onRpc({ pending_key: () => ({ data: KEY, error: null }), finalize_upload: () => ({ data: "rejected", error: null }) })
  h.storage.download.mockResolvedValueOnce({ data: blob(bytes), error: null })
  expect(await finalizeScanUpload(FILE)).toEqual({ ok: false, failure: "invalid_file" })
  expect(rpcArgs("finalize_upload")[0]).toMatchObject({ p_media_type: null, p_byte_size: null, p_sha256: null, p_reject_reason: reason })
})

it("FILE-01 finalize accepts exactly 10 MB", async () => {
  onRpc({ pending_key: () => ({ data: KEY, error: null }), finalize_upload: () => ({ data: "ready", error: null }) })
  h.storage.download.mockResolvedValueOnce({ data: blob(pdf(10 * 1024 * 1024)), error: null })
  expect(await finalizeScanUpload(FILE)).toEqual({ ok: true })
  expect(rpcArgs("finalize_upload")[0]).toMatchObject({ p_byte_size: 10485760, p_reject_reason: null })
})

it("LIFE-03 finalize after the card was archived: valid bytes, database rejects (lost generation), reported as not available", async () => {
  onRpc({ pending_key: () => ({ data: KEY, error: null }), finalize_upload: () => ({ data: "rejected", error: null }) })
  expect(await finalizeScanUpload(FILE)).toEqual({ ok: false, failure: "not_allowed" })
  expect(rpcArgs("finalize_upload")[0]).toMatchObject({ p_media_type: "application/pdf", p_reject_reason: null })
})

it("LIFE-03 finalize with no stored object: recorded as missing bytes; a transient error leaves the reservation pending for a retry", async () => {
  onRpc({ pending_key: () => ({ data: KEY, error: null }), finalize_upload: () => ({ data: "rejected", error: null }) })
  h.storage.download.mockResolvedValueOnce({ data: null, error: { status: 404, message: "not_found" } })
  expect(await finalizeScanUpload(FILE)).toEqual({ ok: false, failure: "missing_file" })
  expect(rpcArgs("finalize_upload")[0]).toMatchObject({ p_reject_reason: "missing_bytes" })
  h.admin.rpc.mockClear()
  onRpc({ pending_key: () => ({ data: KEY, error: null }) })
  h.storage.download.mockRejectedValueOnce(new Error("socket hang up"))
  expect(await finalizeScanUpload(FILE)).toEqual({ ok: false, failure: "unavailable" })
  expect(rpcArgs("finalize_upload")).toEqual([])
})

it("LIFE-06 a missing bucket is an outage, not a missing file: nothing is rejected or marked missing", async () => {
  onRpc({ pending_key: () => ({ data: KEY, error: null }), authorize_download: () => ({ data: null, error: { code: "BB020" } }), restore_probe: () => ({ data: KEY, error: null }) })
  h.storage.download.mockResolvedValue({ data: null, error: { status: 400, statusCode: "404", message: "Bucket not found" } })
  expect(await finalizeScanUpload(FILE)).toEqual({ ok: false, failure: "unavailable" })
  expect(await issueScanDownload({ fileId: FILE })).toEqual({ ok: false, failure: "unavailable" })
  expect(rpcArgs("finalize_upload")).toEqual([])
  expect(rpcArgs("confirm_restored_file")).toEqual([])
})

it("HOST-01 (local shape) the trusted path never lists, removes or overwrites objects and never touches a table directly", async () => {
  onRpc({
    authorize_download: () => ({ data: [grant], error: null }), record_issuance: () => ({ data: true, error: null }),
    reserve_upload: () => ({ data: [{ file_id: FILE, object_key: KEY }], error: null }),
    pending_key: () => ({ data: KEY, error: null }), finalize_upload: () => ({ data: "ready", error: null }),
  })
  await issueScanDownload({ fileId: FILE })
  await reserveScanUpload(DOC)
  await finalizeScanUpload(FILE)
  expect(h.storage.remove).not.toHaveBeenCalled()
  expect(h.storage.list).not.toHaveBeenCalled()
  expect(h.admin.from).not.toHaveBeenCalled()
  expect(h.user.from).not.toHaveBeenCalled()
  expect(h.user.rpc).not.toHaveBeenCalled()
})
