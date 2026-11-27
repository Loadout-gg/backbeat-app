import { createClient as supabaseClient } from "@supabase/supabase-js"
import { expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ server: vi.fn(), workspace: vi.fn(), revalidatePath: vi.fn() }))
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.server }))
vi.mock("@/lib/actions/workspace", () => ({ getCurrentWorkspaceId: mocks.workspace }))
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }))
import { createBookingPayment } from "@/lib/actions/booking-payments"

const BOOKING = "11111111-1111-4111-8111-111111111111"
const WORKSPACE = "22222222-2222-4222-8222-222222222222"
const FIRST = "33333333-3333-4333-8333-333333333333"
const NEXT = "44444444-4444-4444-8444-444444444444"
const ORIGIN = "https://backbeat.invalid"

it("keeps one insert when its response is lost and the same creation is retried concurrently", async () => {
  const input = { kind: "deposit", currency: "EUR", amount_minor: 15000, paid_on: "2030-05-02", note: " paid " } as const
  const rows = new Map<string, Record<string, unknown>>()
  const attempts: string[] = []
  let lookups = 0
  const rejected: string[] = []
  const fetch: typeof globalThis.fetch = async (request, init) => {
    const url = new URL(String(request))
    const method = init?.method
    if (url.origin === ORIGIN && url.pathname === "/rest/v1/bookings" && method === "GET") {
      expect(Object.fromEntries(url.searchParams)).toEqual({ select: "id", id: `eq.${BOOKING}`, workspace_id: `eq.${WORKSPACE}`, fee_currency: "eq.EUR" })
      return Response.json([{ id: BOOKING }])
    }
    if (url.origin === ORIGIN && url.pathname === "/rest/v1/booking_payments" && method === "POST" && typeof init?.body === "string") {
      expect(url.searchParams.get("select")).toBe("id")
      const accept = new Headers(init.headers).get("accept")
      expect(accept).toBe("application/vnd.pgrst.object+json")
      const row = JSON.parse(init.body)
      expect(row).toEqual({ ...input, note: "paid", due_on: null, id: expect.any(String), workspace_id: WORKSPACE, booking_id: BOOKING })
      const id = row.id as string
      attempts.push(id)
      if (rows.has(id)) return Response.json({ code: "23505", message: "fixture collision" }, { status: 409 })
      rows.set(id, row)
      if (id === FIRST) throw new Error("Synthetic transport loss after commit")
      return Response.json({ id }, { status: 201, headers: { "content-type": accept! } })
    }
    if (url.origin === ORIGIN && url.pathname === "/rest/v1/booking_payments" && method === "GET") {
      lookups++
      expect(Object.fromEntries(url.searchParams)).toEqual({ select: "kind,amount_minor,currency,due_on,paid_on,note",
        id: `eq.${FIRST}`, workspace_id: `eq.${WORKSPACE}`, booking_id: `eq.${BOOKING}` })
      const { kind, amount_minor, currency, due_on, paid_on, note } = rows.get(FIRST)!
      return Response.json([{ kind, amount_minor, currency, due_on, paid_on, note }])
    }
    rejected.push(`${method} ${url}`)
    throw new Error("Unexpected synthetic request")
  }
  const client = supabaseClient(ORIGIN, "synthetic-fixture-key", {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch },
  })
  mocks.server.mockResolvedValue({ from: client.from.bind(client), auth: { getUser: async () => ({ data: { user: { id: "fixture" } } }) } })
  mocks.workspace.mockResolvedValue(WORKSPACE)
  const log = vi.spyOn(console, "error").mockImplementation(() => {})
  try {
    expect(await createBookingPayment(BOOKING, input, FIRST)).toMatchObject({ success: false })
    expect(rows.size).toBe(1)
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
    expect(await Promise.all([createBookingPayment(BOOKING, input, FIRST), createBookingPayment(BOOKING, input, FIRST)]))
      .toEqual([{ success: true }, { success: true }])
    expect(rows.size).toBe(1)
    expect(lookups).toBe(2)
    expect(await createBookingPayment(BOOKING, input, NEXT)).toEqual({ success: true })
    expect(rows.size).toBe(2)
    expect(attempts).toEqual([FIRST, FIRST, FIRST, NEXT])
    expect(rejected).toEqual([])
  } finally { log.mockRestore() }
})
