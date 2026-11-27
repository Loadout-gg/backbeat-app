import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { SCAN_FAILURE_COPY, SCAN_FAILURE_STATUS, issueScanDownload } from "@/lib/travel-documents/scan-service"

// Download of one travel-document scan version (owner decision on PR #36, D2): a same-origin,
// authenticated POST that carries an app file id and, optionally, the booking or event the
// member is working on. Never a Storage key, a TTL or a reason. The response is the short-lived
// signed link, or fixed copy; it is never cacheable and never logged.

export const dynamic = "force-dynamic"

const NO_STORE = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
} as const

const idSchema = z.guid()
const bodySchema = z.object({
  bookingId: z.guid().nullable().optional(),
  eventId: z.guid().nullable().optional(),
}).strict()

function reply(body: { url: string } | { error: string }, status: number) {
  return NextResponse.json(body, { status, headers: NO_STORE })
}

/** Browsers send Origin on every POST: it must name this deployment's own host. */
function isSameOrigin(request: NextRequest): boolean {
  if ((request.headers.get("sec-fetch-site") ?? "same-origin") !== "same-origin") return false
  const origin = request.headers.get("origin")
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host")
  if (!origin || !host) return false
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}

export async function POST(request: NextRequest, context: { params: Promise<{ fileId: string }> }) {
  if (!isSameOrigin(request)) return reply({ error: "Request not allowed." }, 403)
  const { fileId } = await context.params
  if (!idSchema.safeParse(fileId).success) return reply({ error: SCAN_FAILURE_COPY.not_found }, 404)
  let raw: unknown = {}
  try {
    const text = await request.text()
    if (text.length > 512) return reply({ error: "Request not allowed." }, 400)
    if (text.trim()) raw = JSON.parse(text)
  } catch {
    return reply({ error: "Request not allowed." }, 400)
  }
  const body = bodySchema.safeParse(raw)
  if (!body.success) return reply({ error: "Request not allowed." }, 400)

  const result = await issueScanDownload({ fileId, bookingId: body.data.bookingId, eventId: body.data.eventId })
  if (!result.ok) return reply({ error: SCAN_FAILURE_COPY[result.failure] }, SCAN_FAILURE_STATUS[result.failure])
  return reply({ url: result.url }, 200)
}
