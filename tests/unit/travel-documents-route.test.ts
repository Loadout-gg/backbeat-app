// URL-01 / CORE-05 / CORE-06 (LOCAL_INPROCESS): the download endpoint is a same-origin POST that
// takes app ids only and answers with a non-cacheable body.
import { beforeEach, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
const issue = vi.hoisted(() => vi.fn())
vi.mock("@/lib/travel-documents/scan-service", () => ({
  issueScanDownload: issue,
  SCAN_FAILURE_COPY: { not_found: "Scan not found.", not_allowed: "This scan is not available. Reload the page and try again.", disabled: "Scan storage is not enabled yet.", unauthenticated: "Not authenticated" },
  SCAN_FAILURE_STATUS: { not_found: 404, not_allowed: 409, disabled: 503, unauthenticated: 401 },
}))
import * as route from "@/app/api/travel-documents/files/[fileId]/download/route"

const FILE = "11111111-1111-4111-8111-111111111111"
const BOOKING = "33333333-3333-4333-8333-333333333333"
const LINK = "https://project.supabase.co/storage/v1/object/sign/x?token=T"
function post(body: unknown, headers: Record<string, string> = {}, fileId = FILE) {
  const request = new NextRequest(`https://app.example.test/api/travel-documents/files/${fileId}/download`, {
    method: "POST", body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { origin: "https://app.example.test", host: "app.example.test", "content-type": "application/json", ...headers },
  })
  return route.POST(request, { params: Promise.resolve({ fileId }) })
}
beforeEach(() => { issue.mockReset().mockResolvedValue({ ok: true, url: LINK }) })

it("URL-01 returns the link in a response that is never cached or shared", async () => {
  const response = await post({ bookingId: BOOKING })
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ url: LINK })
  expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0")
  expect(response.headers.get("pragma")).toBe("no-cache")
  expect(response.headers.get("referrer-policy")).toBe("no-referrer")
  expect(issue).toHaveBeenCalledExactlyOnceWith({ fileId: FILE, bookingId: BOOKING, eventId: undefined })
  expect(route.dynamic).toBe("force-dynamic")
})

it("URL-01 only POST exists: a link is never issued by a cacheable GET", () => {
  expect(Object.keys(route).filter(name => /^(GET|HEAD|PUT|PATCH|DELETE|OPTIONS)$/.test(name))).toEqual([])
})

it("CORE-06 an empty body is a valid request (no context, no reason)", async () => {
  expect((await post("")).status).toBe(200)
  expect((await post({})).status).toBe(200)
  expect(issue).toHaveBeenLastCalledWith({ fileId: FILE, bookingId: undefined, eventId: undefined })
})

it.each([
  ["a Storage key", { key: "ws/artist/doc/file" }],
  ["a path", { path: "artist-travel-documents/x" }],
  ["a TTL", { expiresIn: 86400 }],
  ["a reason", { reason: "hotel asked" }],
  ["an actor", { actorId: BOOKING }],
  ["a malformed booking id", { bookingId: "1 OR 1=1" }],
  ["an array", [BOOKING]],
])("CORE-05 a body with %s is refused before any backend access", async (_label, body) => {
  const response = await post(body)
  expect(response.status).toBe(400)
  expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0")
  expect(issue).not.toHaveBeenCalled()
})

it("CORE-05 malformed JSON, an oversized body and a malformed file id are refused before any backend access", async () => {
  expect((await post("{not json")).status).toBe(400)
  expect((await post(JSON.stringify({ bookingId: BOOKING }) + " ".repeat(600))).status).toBe(400)
  expect((await post({}, {}, "not-a-uuid")).status).toBe(404)
  expect(issue).not.toHaveBeenCalled()
})

it.each([
  ["another site", { origin: "https://evil.example" }],
  ["no Origin", { origin: "" }],
  ["a cross-site fetch", { "sec-fetch-site": "cross-site" }],
  ["a same-site sibling", { "sec-fetch-site": "same-site" }],
  ["a malformed Origin", { origin: "null" }],
])("URL-01 a request from %s is refused before any backend access", async (_label, headers) => {
  const response = await post({}, headers)
  expect(response.status).toBe(403)
  expect(issue).not.toHaveBeenCalled()
})

it("URL-01 the forwarded host is the one compared with Origin behind the platform proxy", async () => {
  expect((await post({}, { host: "internal:3000", "x-forwarded-host": "app.example.test" })).status).toBe(200)
  expect((await post({}, { host: "app.example.test", "x-forwarded-host": "other.example.test" })).status).toBe(403)
})

it.each([
  ["not_found", 404, "Scan not found."], ["not_allowed", 409, "This scan is not available. Reload the page and try again."],
  ["disabled", 503, "Scan storage is not enabled yet."], ["unauthenticated", 401, "Not authenticated"],
])("CORE-05 failure %s -> status %i with fixed copy, no link, no cache", async (failure, status, error) => {
  issue.mockResolvedValueOnce({ ok: false, failure })
  const response = await post({})
  expect(response.status).toBe(status)
  expect(await response.json()).toEqual({ error })
  expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0")
})
