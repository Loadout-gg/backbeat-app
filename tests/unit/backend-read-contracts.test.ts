import { beforeEach, describe, expect, it, vi } from "vitest"
import { createClient as createSupabaseClient } from "@supabase/supabase-js"

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  workspace: vi.fn(),
  getUser: vi.fn(),
  revalidate: vi.fn(),
}))

vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.createClient,
}))
vi.mock("@/lib/actions/workspace", () => ({
  getCurrentWorkspaceId: mocks.workspace,
}))
vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidate,
}))

import { getBookings } from "@/lib/actions/bookings"
import {
  createEvent,
  listEvents,
  listEventsInProgress,
  listPromoters,
} from "@/lib/actions/events"
import { listArtists } from "@/lib/actions/artists"
import { getDashboardStats } from "@/lib/actions/dashboard"

const WORKSPACE = "11111111-1111-4111-8111-111111111111"
const ARTIST = "22222222-2222-4222-8222-222222222222"
const PROMOTER = "33333333-3333-4333-8333-333333333333"
const EVENT = "44444444-4444-4444-8444-444444444444"

type Table = "artists" | "events" | "bookings" | "promoters"
type Row = Record<string, unknown> & { id: string; workspace_id: string }
type RequestRecord = {
  url: URL
  method: string
  headers: Headers
  body: unknown
}

let requests: RequestRecord[]
let respond: (request: RequestRecord) => Response | Promise<Response>

function reply(body: unknown, count?: number | string, status = 200): Response {
  const headers = new Headers({ "content-type": "application/json" })
  if (count !== undefined) headers.set("content-range", `0-0/${count}`)
  return new Response(
    body === undefined ? null : JSON.stringify(body),
    { status, headers },
  )
}

function tableOf(request: RequestRecord): Table {
  return request.url.pathname.split("/").at(-1) as Table
}

function makeRow(table: Table, index: number): Row {
  const common = {
    id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    workspace_id: WORKSPACE,
    created_at: "2026-01-01T00:00:00Z",
  }

  if (table === "artists") {
    return {
      ...common,
      name: "Same name",
      surname: null,
      stage_name: null,
      email: null,
      phone: null,
      notes: null,
      location: null,
      genres: null,
      fee: 0,
      currency: "EUR",
      travel_fee: null,
      pricing_notes: null,
      social_links: null,
      overview: null,
      dj_equipment: null,
      sound_system: null,
      allergies: null,
      special_diet: null,
      special_needs: null,
      documents: null,
      updated_at: null,
      profile_image_url: null,
    }
  }

  if (table === "promoters") {
    return {
      ...common,
      name: "Same name",
      company_name: null,
      email: null,
      phone: null,
      notes: null,
    }
  }

  const scheduled = {
    ...common,
    date: "2020-01-01",
    status: "in_progress",
    artist_id: ARTIST,
  }

  if (table === "events") {
    return {
      ...scheduled,
      title: "Synthetic event",
      location: null,
      promoter_id: null,
      artists: { id: ARTIST, name: "Artist" },
      promoters: null,
    }
  }

  return {
    ...scheduled,
    start_time: "10:30:00",
    duration_minutes: null,
    notes: null,
    venue_name: null,
    venue_address: null,
    contact_name_main: null,
    contact_phone_main: null,
    contact_email_main: null,
    fee_amount_minor: null,
    fee_currency: null,
    updated_at: "2026-01-01T00:00:00Z",
    artist: null,
  }
}

beforeEach(() => {
  vi.resetAllMocks()
  requests = []
  respond = () => reply([], 0)

  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url,
    )

    if (
      url.origin !== "https://backbeat.invalid" ||
      !url.pathname.startsWith("/rest/v1/")
    ) {
      throw new Error("Unexpected test request")
    }

    const rawBody = init?.body
    const record: RequestRecord = {
      url,
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers),
      body: typeof rawBody === "string" ? JSON.parse(rawBody) : null,
    }
    requests.push(record)
    return respond(record)
  }

  const client = createSupabaseClient(
    "https://backbeat.invalid",
    "synthetic-public-key-not-a-credential",
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      global: { fetch: fetcher },
    },
  )

  mocks.createClient.mockResolvedValue({
    from: client.from.bind(client),
    auth: { getUser: mocks.getUser },
  })
  mocks.workspace.mockResolvedValue(WORKSPACE)
  mocks.getUser.mockResolvedValue({
    data: { user: { id: "synthetic-user" } },
    error: null,
  })
})

function serveRows(source: Row[], cap: number): void {
  respond = request => {
    const params = request.url.searchParams
    const filtered = source.filter(row =>
      ["workspace_id", "artist_id", "status"].every(column => {
        const predicate = params.get(column)
        return predicate === null || predicate === `eq.${String(row[column])}`
      }),
    )

    const order = (params.get("order") ?? "")
      .split(",")
      .filter(Boolean)
      .map(value => value.split("."))

    filtered.sort((a, b) => {
      for (const [column, direction] of order) {
        const comparison = String(a[column] ?? "")
          .localeCompare(String(b[column] ?? ""))
        if (comparison) return direction === "desc" ? -comparison : comparison
      }
      return 0
    })

    const from = Number(params.get("offset") ?? 0)
    const limit = Number(params.get("limit") ?? cap)
    return reply(
      filtered.slice(from, from + Math.min(limit, cap)),
      filtered.length,
    )
  }
}

describe("dashboard counts", () => {
  const counts: Record<Table, number> = {
    artists: 5,
    events: 3,
    bookings: 2,
    promoters: 4,
  }

  it("counts the three maintained datasets through scoped exact HEAD requests", async () => {
    respond = request => reply(undefined, counts[tableOf(request)])
    expect(await getDashboardStats()).toEqual({
      totalArtists: 5,
      eventsInProgress: 3,
      bookingsInProgress: 0,
      totalPromoters: 4,
    })

    expect(requests.map(tableOf).sort()).toEqual([
      "artists", "events", "promoters",
    ])
    for (const request of requests) {
      expect(request.method).toBe("HEAD")
      expect(request.headers.get("prefer")).toContain("count=exact")
      expect(request.url.searchParams.get("select")).toBe("id")
      expect(request.url.searchParams.get("workspace_id")).toBe(`eq.${WORKSPACE}`)
      expect(request.url.searchParams.get("status")).toBe(
        tableOf(request) === "events"
          ? "eq.in_progress"
          : null,
      )
    }
  })

  it("returns successful zero counts only after successful exact counts", async () => {
    respond = () => reply(undefined, 0)
    expect(await getDashboardStats()).toEqual({
      totalArtists: 0,
      eventsInProgress: 0,
      bookingsInProgress: 0,
      totalPromoters: 0,
    })
  })

  it.each(["artists", "events", "promoters"] as const)(
    "rejects a %s query error rather than displaying zero",
    async table => {
      respond = request => tableOf(request) === table
        ? reply(undefined, 0, 500)
        : reply(undefined, counts[tableOf(request)])

      await expect(getDashboardStats()).rejects.toThrow(
        "Unable to load dashboard counts. Please try again.",
      )
    },
  )

  it.each(["artists", "events", "promoters"] as const)(
    "rejects missing/invalid %s counts",
    async table => {
      for (const invalid of [undefined, "*", "-1", "NaN", "9007199254740992"]) {
        respond = request => reply(
          undefined,
          tableOf(request) === table ? invalid : counts[tableOf(request)],
        )
        await expect(getDashboardStats()).rejects.toThrow(
          "Unable to load dashboard counts. Please try again.",
        )
      }
    },
  )

  it("does not issue count queries without a resolved workspace", async () => {
    mocks.workspace.mockRejectedValueOnce(new Error("No active workspace"))
    await expect(getDashboardStats()).rejects.toThrow("No active workspace")
    expect(requests).toEqual([])
  })
})
